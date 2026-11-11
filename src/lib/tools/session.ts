import type { SendFn } from "../batch";
import type { RequestLookup } from "../flows/flows";
import type { ScriptRunner } from "../testing/scriptRunner";
import type { Vars } from "../template";
import type { Environment } from "../environments";
import { resolveInputs, runLookup, runLookupCall, runWriteCall, ToolNotRunnableError, writeCallGuard } from "./engine";
import { saveLookup } from "./lookupStore";
import type { CallResult, LookupRecord, Tool } from "./types";

/**
 * What Use mode keeps for one tool while the app is open: the typed inputs, the answers on screen (a lookup filling
 * in, or a saved one being viewed) and what is running. Plain state with subscribers, so a lookup keeps going while
 * another tool or section is on screen. React reads it with useSyncExternalStore (see useToolSession).
 */

export interface PendingPick {
  callId: string;
  rows: unknown[];
}

export interface SessionState {
  /** What is typed in the input boxes. */
  inputs: Record<string, string>;
  /** The answers on screen, by call id. */
  results: Record<string, CallResult>;
  /** Calls that were sent and have not finished. */
  sending: string[];
  /** A lookup is running. */
  running: boolean;
  /** When the lookup on screen started (ISO). Null before the first lookup or saved lookup. */
  startedAt: string | null;
  /** The saved lookup being viewed, or null when the answers come from a lookup made now. */
  viewing: LookupRecord | null;
  /** Id of the saved lookup the answers on screen are (viewed, or just made and saved). Null while a lookup runs. */
  recordId: string | null;
  /** What Action buttons got back, by write call id. Cleared when a lookup starts or a saved lookup is shown. */
  writes: Record<string, CallResult>;
  /** Write calls that were sent and have not finished. */
  writing: string[];
  /** A pick-a-row call is waiting for the user to choose a row. */
  pending: PendingPick[];
  /** Why Look up could not start. */
  error: string | null;
  /** The run on screen ended by Stop. */
  stopped: boolean;
  /** The saved lookups were read from storage (so opening the tool shows the latest one only once). */
  loaded: boolean;
}

export interface LookupDeps {
  findRequest: RequestLookup;
  /** Environment variables as name to value (use environmentVars()). */
  envVars: Vars;
  environmentName?: string;
  send: SendFn;
  scripts: ScriptRunner;
  /** Replaced in tests. Default: saveLookup, which also trims old lookups. */
  save?: (record: LookupRecord, keepHistory: boolean) => Promise<unknown>;
}

const START: SessionState = {
  inputs: {},
  results: {},
  sending: [],
  writes: {},
  writing: [],
  running: false,
  startedAt: null,
  viewing: null,
  recordId: null,
  pending: [],
  error: null,
  stopped: false,
  loaded: false,
};

export interface ActionDeps extends Omit<LookupDeps, "save"> {
  /** The environment in use. A coloured one needs confirming first. */
  environment?: Environment | null;
  /**
   * Asked before the write call is sent: on a coloured environment (with its guard), or on any environment when the block has
   * confirm text (guard is null then). Resolve true to send.
   */
  confirm: (guard: ReturnType<typeof writeCallGuard>, callId: string) => Promise<boolean>;
}

export class ToolSession {
  private state: SessionState = START;
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private picks = new Map<string, (index: number | null) => void>();

  constructor(readonly toolId: string) {}

  getState = (): SessionState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  setInput(name: string, value: string) {
    this.set({ inputs: { ...this.state.inputs, [name]: value } });
  }

  markLoaded() {
    if (!this.state.loaded) this.set({ loaded: true });
  }

  /**
   * Shows a saved lookup: its answers and the inputs it was made with. Nothing is sent.
   * Ignored while a lookup is running.
   */
  show(record: LookupRecord) {
    if (this.state.running) return;
    const results: Record<string, CallResult> = {};
    for (const r of record.results) results[r.callId] = r;
    this.set({ inputs: { ...record.inputs }, results, sending: [], writes: {}, writing: [], startedAt: record.startedAt, viewing: record, recordId: record.id, pending: [], error: null, stopped: record.stopped });
  }

  /** Stops a running lookup: calls not yet started end as Stopped, sent ones are cancelled. */
  stop() {
    this.abort?.abort();
  }

  /** The user chose a row for a pick-a-row call (null for none). */
  choosePick(callId: string, index: number | null) {
    this.picks.get(callId)?.(index);
  }

  /**
   * Runs one write call (an Action button) with the answers on screen. Not while a lookup runs, and not twice at once.
   * The result is kept in `writes` and returned. `confirmAlways` asks even on an unmarked environment (the block has confirm text).
   */
  async runAction(tool: Tool, callId: string, deps: ActionDeps, confirmAlways = false): Promise<CallResult | null> {
    if (this.state.running || this.state.writing.includes(callId)) return null;
    this.set({ writing: [...this.state.writing, callId] });
    const finish = (r: CallResult) => {
      this.set({ writes: { ...this.state.writes, [callId]: r }, writing: this.state.writing.filter((id) => id !== callId) });
      return r;
    };
    const name = tool.calls.find((c) => c.id === callId)?.name ?? "";
    try {
      if (confirmAlways && !writeCallGuard(deps.environment) && !(await deps.confirm(null, callId))) {
        return finish({ callId, name, state: "skipped", reason: "not-confirmed", message: "Not sent: not confirmed." });
      }
      const result = await runWriteCall(tool, callId, this.state.inputs, {
        findRequest: deps.findRequest,
        envVars: deps.envVars,
        send: deps.send,
        scripts: deps.scripts,
        prior: this.state.results,
        environment: deps.environment,
        confirm: (guard) => deps.confirm(guard, callId),
      });
      return finish(result);
    } catch (e) {
      return finish({ callId, name, state: "network-error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Runs one lookup call again and puts its answer in place. The saved lookup is not changed. */
  async retryCall(tool: Tool, callId: string, deps: Omit<LookupDeps, "save">): Promise<CallResult | null> {
    if (this.state.running || this.state.sending.includes(callId)) return null;
    this.set({ sending: [...this.state.sending, callId] });
    try {
      const r = await runLookupCall(tool, callId, this.state.inputs, { findRequest: deps.findRequest, envVars: deps.envVars, send: deps.send, scripts: deps.scripts, prior: this.state.results });
      this.set({ results: { ...this.state.results, [callId]: r }, sending: this.state.sending.filter((id) => id !== callId) });
      return r;
    } catch {
      this.set({ sending: this.state.sending.filter((id) => id !== callId) });
      return null;
    }
  }

  /**
   * Runs the tool's lookup. Each block fills the moment its call finishes. The finished lookup is saved
   * (unless the tool keeps no history) and returned; null when it could not start.
   */
  async lookup(tool: Tool, deps: LookupDeps, rawInputs: Record<string, string> = this.state.inputs): Promise<LookupRecord | null> {
    if (this.state.running) return null;
    const controller = new AbortController();
    this.abort = controller;
    const inputs = resolveInputs(tool, rawInputs);
    this.picks.clear();
    this.set({ results: {}, sending: [], writes: {}, running: true, startedAt: new Date().toISOString(), viewing: null, recordId: null, pending: [], error: null, stopped: false });
    try {
      const run = await runLookup(tool, rawInputs, {
        findRequest: deps.findRequest,
        envVars: deps.envVars,
        send: deps.send,
        scripts: deps.scripts,
        signal: controller.signal,
        onCallStart: (id) => this.set({ sending: [...this.state.sending, id] }),
        onCall: (r) => this.set({ results: { ...this.state.results, [r.callId]: r }, sending: this.state.sending.filter((id) => id !== r.callId) }),
        pickRow: ({ call, result, rows }) => {
          // Only a table block can show the rows to choose from; without one the first row is used.
          if (!tool.blocks.some((b) => b.type === "table" && b.callId === call.id)) return Promise.resolve(0);
          this.set({ results: { ...this.state.results, [call.id]: result }, pending: [...this.state.pending, { callId: call.id, rows }] });
          return new Promise<number | null>((resolve) => {
            this.picks.set(call.id, (i) => {
              this.picks.delete(call.id);
              this.set({ pending: this.state.pending.filter((p) => p.callId !== call.id) });
              resolve(i);
            });
          });
        },
      });
      const results: Record<string, CallResult> = {};
      for (const r of run.results) results[r.callId] = r;
      const record: LookupRecord = { ...run, inputs, toolName: tool.name, environmentName: deps.environmentName };
      this.set({ results, sending: [], running: false, startedAt: run.startedAt, recordId: tool.settings.keepHistory ? run.id : null, pending: [], stopped: run.stopped });
      try {
        await (deps.save ?? saveLookup)(record, tool.settings.keepHistory);
      } catch {
        // History is a convenience: the answers on screen are still good.
      }
      return record;
    } catch (e) {
      const message = e instanceof ToolNotRunnableError ? `Look up can't start: ${e.message}` : `The lookup stopped with an error: ${e instanceof Error ? e.message : String(e)}`;
      this.set({ running: false, sending: [], pending: [], error: message });
      return null;
    } finally {
      this.abort = null;
      this.picks.clear();
    }
  }
}

/** One ToolSession per tool, created when first needed and kept for the life of the app, so a lookup carries on while another tool or section is shown. */
export class SessionRegistry {
  private sessions = new Map<string, ToolSession>();
  private listeners = new Set<() => void>();
  private version = 0;

  get = (toolId: string): ToolSession => {
    let s = this.sessions.get(toolId);
    if (!s) {
      s = new ToolSession(toolId);
      s.subscribe(() => {
        this.version++;
        this.listeners.forEach((l) => l());
      });
      this.sessions.set(toolId, s);
    }
    return s;
  };

  /** Ids of tools with a lookup running. */
  runningIds = (): string[] => [...this.sessions.values()].filter((s) => s.getState().running).map((s) => s.toolId);

  /** Changes on any session's change; for useSyncExternalStore. */
  getVersion = (): number => this.version;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Stops every running lookup and forgets a tool's session (the tool was deleted). */
  drop(toolId: string) {
    this.sessions.get(toolId)?.stop();
    this.sessions.delete(toolId);
  }
}

/** The table rows a pending pick-a-row call is offering, if any. */
export function pendingRows(state: SessionState, callId: string): unknown[] | null {
  return state.pending.find((p) => p.callId === callId)?.rows ?? null;
}
