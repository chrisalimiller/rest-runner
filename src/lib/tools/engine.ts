import type { SendFn } from "../batch";
import { guardFor, type Environment } from "../environments";
import type { RequestLookup } from "../flows/flows";
import { newId } from "../ids";
import { requestPlaceholders } from "../request";
import { sendWithScripts } from "../requestScripts";
import type { Vars } from "../template";
import { readPath } from "../testing/jsonPath";
import type { ScriptRunner } from "../testing/scriptRunner";
import type { RequestDef } from "../types";
import { orderCalls } from "./order";
import type { CallResult, LookupRun, Tool, ToolCall } from "./types";

/** At most this many calls are in flight at once. */
export const MAX_CONCURRENT_CALLS = 6;

/** Look up refuses to start (a loop between calls, for example). The message is ready to show. */
export class ToolNotRunnableError extends Error {}

export interface PickRowRequest {
  call: ToolCall;
  /** The finished call, with the response the rows came from. */
  result: CallResult;
  rows: unknown[];
}

export interface ToolRunContext {
  findRequest: RequestLookup;
  /** Environment variables as name to value (use environmentVars()). */
  envVars: Vars;
  send: SendFn;
  scripts: ScriptRunner;
  signal?: AbortSignal;
  /** Default MAX_CONCURRENT_CALLS. */
  maxConcurrent?: number;
  /** Called when a call is sent (not for calls that are skipped). */
  onCallStart?: (callId: string) => void;
  /** Called with each finished call, as it finishes, so blocks can fill in one by one. */
  onCall?: (result: CallResult) => void;
}

export interface LookupContext extends ToolRunContext {
  /**
   * Asked when a pick-a-row call gets a list. Calls that need the row wait for the answer; the others carry on.
   * Resolve with the chosen index, or null for none (the calls that need it are skipped). Without this, the first row is used.
   */
  pickRow?: (request: PickRowRequest) => Promise<number | null>;
}

export interface WriteCallContext extends ToolRunContext {
  /** Results of the last lookup, for the fields (and picked row) this call's placeholders map to. */
  prior?: Record<string, CallResult>;
  /** The environment in use. A coloured environment is a production guard: the call needs `confirm`. */
  environment?: Environment | null;
  /** The confirm step for guarded environments (PR 4 supplies the dialog). Without it a guarded write call is not sent. */
  confirm?: (guard: NonNullable<ReturnType<typeof guardFor>>, call: ToolCall) => Promise<boolean>;
}

/** The guard info when the environment is marked (coloured), so a write call must be confirmed first. */
export function writeCallGuard(environment: Environment | null | undefined) {
  return guardFor(environment);
}

/** The inputs a lookup runs with: what was typed, else the input's default, else empty. */
export function resolveInputs(tool: Tool, given: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of tool.inputs) {
    const v = given[i.name];
    out[i.name] = v !== undefined && v !== "" ? v : (i.default ?? "");
  }
  return out;
}

// ---- reading values out of finished calls ----

const jsonCache = new WeakMap<CallResult, unknown>();

/** The response body as JSON, or undefined when the call has no response or the body is not JSON. */
export function callJson(result: CallResult): unknown {
  if (jsonCache.has(result)) return jsonCache.get(result);
  let value: unknown;
  if (result.response) {
    try {
      value = JSON.parse(result.response.body);
    } catch {
      value = undefined;
    }
  }
  jsonCache.set(result, value);
  return value;
}

function listPathOf(call: ToolCall): string {
  const p = call.pickRow?.listPath.trim() ?? "";
  return p === "$" ? "" : p;
}

/** The rows of a pick-a-row call's response, or null when the call is not one or the response has no list. */
export function pickRows(call: ToolCall, result: CallResult): unknown[] | null {
  if (!call.pickRow) return null;
  const list = readPath(callJson(result), listPathOf(call));
  return Array.isArray(list) ? list : null;
}

/** The part of the response a call's fields are read from: the picked row for a pick-a-row call, else the whole response. */
export function callData(call: ToolCall, result: CallResult | undefined): unknown {
  if (!result || result.state !== "done") return undefined;
  if (!call.pickRow) return callJson(result);
  if (!result.picked) return undefined;
  return pickRows(call, result)?.[result.picked.index];
}

/** A field of a finished call, or undefined. Blocks read their fields with this. */
export function readCallField(call: ToolCall, result: CallResult | undefined, path: string): unknown {
  return readPath(callData(call, result), path);
}

/** A value as the text that goes into a request. Null for nothing there (missing, null, empty text). */
export function valueText(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}

// ---- placeholders ----

export interface Resolution {
  /** Values for the mapped placeholders. Unmapped ones are left to the environment. */
  data: Vars;
  /** Placeholders that map to a call field with no value. */
  missing: { placeholder: string; callName: string }[];
}

/**
 * Fills a call's placeholders. For each one: the input (when it has text), then another call's field,
 * then the fixed value; a placeholder with none of these mapped is left for the environment.
 */
export function resolvePlaceholders(
  call: ToolCall,
  def: RequestDef,
  inputs: Record<string, string>,
  calls: Map<string, ToolCall>,
  results: ReadonlyMap<string, CallResult> | Record<string, CallResult>,
): Resolution {
  const get = (id: string) => (results instanceof Map ? results.get(id) : (results as Record<string, CallResult>)[id]);
  const data: Vars = {};
  const missing: Resolution["missing"] = [];
  for (const placeholder of requestPlaceholders(def)) {
    const m = call.mappings[placeholder];
    if (!m) continue;
    const fromInput = m.input !== undefined ? valueText(inputs[m.input]) : null;
    if (fromInput !== null) {
      data[placeholder] = fromInput;
      continue;
    }
    if (m.call) {
      const source = calls.get(m.call.callId);
      const v = source ? valueText(readCallField(source, get(m.call.callId), m.call.path)) : null;
      if (v !== null) {
        data[placeholder] = v;
        continue;
      }
    }
    if (m.fixed !== undefined && m.fixed !== "") {
      data[placeholder] = m.fixed;
      continue;
    }
    if (m.call) missing.push({ placeholder, callName: calls.get(m.call.callId)?.name || "a removed call" });
  }
  return { data, missing };
}

// ---- running one call ----

function skipped(call: ToolCall, reason: NonNullable<CallResult["reason"]>, message: string): CallResult {
  return { callId: call.id, name: call.name, state: "skipped", reason, message };
}

function stopped(call: ToolCall, message = "Stopped."): CallResult {
  return { callId: call.id, name: call.name, state: "stopped", message };
}

function needsMessage(r: Resolution): string {
  return r.missing.map((m) => `Needs ${m.placeholder} from ${m.callName}`).join("; ");
}

/** Sends one call whose values are ready. Never throws. */
async function sendCall(call: ToolCall, def: RequestDef, data: Vars, ctx: ToolRunContext): Promise<CallResult> {
  ctx.onCallStart?.(call.id);
  try {
    const sent = await sendWithScripts({ def, env: ctx.envVars, data, vars: {}, iteration: 0, send: ctx.send, scripts: ctx.scripts, signal: ctx.signal });
    if (sent === null || (ctx.signal?.aborted && !sent.outcome.ok)) return stopped(call);
    const { outcome } = sent;
    const request = { method: outcome.request.method, url: outcome.request.url };
    if (outcome.ok) {
      return { callId: call.id, name: call.name, state: "done", status: outcome.response.status, response: outcome.response, request, sentAt: outcome.sentAt, durationMs: outcome.response.durationMs };
    }
    return { callId: call.id, name: call.name, state: "network-error", error: outcome.error, request, sentAt: outcome.sentAt, durationMs: outcome.durationMs };
  } catch (e) {
    if (ctx.signal?.aborted) return stopped(call);
    return { callId: call.id, name: call.name, state: "network-error", error: e instanceof Error ? e.message : String(e) };
  }
}

function abortPromise(signal: AbortSignal | undefined): { promise: Promise<"aborted">; dispose: () => void } {
  if (!signal) return { promise: new Promise(() => {}), dispose: () => {} };
  let on: () => void = () => {};
  const promise = new Promise<"aborted">((resolve) => {
    on = () => resolve("aborted");
    if (signal.aborted) on();
    else signal.addEventListener("abort", on);
  });
  return { promise, dispose: () => signal.removeEventListener("abort", on) };
}

/**
 * Runs the tool's lookup calls. Write calls are not run (they run from an Action button, see runWriteCall).
 * Independent calls start together, at most `maxConcurrent` at a time; a call starts as soon as every call
 * whose values it needs has finished. Throws ToolNotRunnableError when calls wait on each other in a loop.
 */
export async function runLookup(tool: Tool, rawInputs: Record<string, string>, ctx: LookupContext): Promise<LookupRun> {
  const inputs = resolveInputs(tool, rawInputs);
  const order = orderCalls(tool.calls, (c) => {
    const def = ctx.findRequest(c.requestId);
    return def ? requestPlaceholders(def) : null;
  });
  if (!order.ok) throw new ToolNotRunnableError(order.message);

  const startedAt = new Date().toISOString();
  const max = Math.max(1, ctx.maxConcurrent ?? MAX_CONCURRENT_CALLS);
  const byId = new Map(tool.calls.map((c) => [c.id, c]));
  const results = new Map<string, CallResult>();
  const finished = new Set<string>();
  const started = new Set<string>();
  let running = 0;
  let wasStopped = false;
  let over = false;

  const depsOf = (call: ToolCall): string[] => {
    const def = ctx.findRequest(call.requestId);
    const used = def ? requestPlaceholders(def) : [];
    return [...new Set(used.map((p) => call.mappings[p]?.call?.callId).filter((id): id is string => !!id && byId.has(id)))];
  };

  return new Promise<LookupRun>((resolveRun) => {
    const finish = (call: ToolCall, result: CallResult | null) => {
      if (result) {
        results.set(call.id, result);
        if (result.state === "stopped") wasStopped = true;
        ctx.onCall?.(result);
      }
      finished.add(call.id);
    };

    const startCall = (call: ToolCall, def: RequestDef, data: Vars) => {
      started.add(call.id);
      running++;
      void (async () => {
        let result = await sendCall(call, def, data, ctx);
        // The slot is free while the user chooses a row.
        running--;
        pump();
        if (result.state === "done" && call.pickRow) result = await choose(call, result);
        finish(call, result);
        pump();
      })();
    };

    const choose = async (call: ToolCall, result: CallResult): Promise<CallResult> => {
      const rows = pickRows(call, result);
      if (!rows) return { ...result, rowCount: 0 };
      const withCount = { ...result, rowCount: rows.length };
      if (rows.length === 0) return withCount;
      let index: number | null = 0;
      if (ctx.pickRow) {
        const abort = abortPromise(ctx.signal);
        try {
          index = await Promise.race([ctx.pickRow({ call, result: withCount, rows }), abort.promise.then(() => null)]);
        } catch {
          index = null;
        } finally {
          abort.dispose();
        }
      }
      if (index === null || !Number.isInteger(index) || index < 0 || index >= rows.length) return withCount;
      return { ...withCount, picked: { index } };
    };

    const pump = () => {
      let again = true;
      while (again) {
        again = false;
        for (const call of order.order) {
          if (started.has(call.id) || finished.has(call.id)) continue;
          if (!depsOf(call).every((d) => finished.has(d))) continue;
          if (ctx.signal?.aborted) {
            finish(call, call.write ? null : stopped(call, "Stopped before this call started."));
            again = true;
            continue;
          }
          if (call.write) {
            finish(call, null);
            again = true;
            continue;
          }
          const def = ctx.findRequest(call.requestId);
          if (!def) {
            finish(call, skipped(call, "missing-request", "Request missing"));
            again = true;
            continue;
          }
          const r = resolvePlaceholders(call, def, inputs, byId, results);
          if (r.missing.length > 0) {
            finish(call, skipped(call, "needs-value", needsMessage(r)));
            again = true;
            continue;
          }
          if (running >= max) continue;
          startCall(call, def, r.data);
        }
      }
      if (!over && finished.size === tool.calls.length) {
        over = true;
        ctx.signal?.removeEventListener("abort", pump);
        resolveRun({
          id: newId(),
          toolId: tool.id,
          startedAt,
          inputs,
          results: tool.calls.map((c) => results.get(c.id)).filter((r): r is CallResult => !!r),
          stopped: wasStopped || !!ctx.signal?.aborted,
        });
      }
    };

    ctx.signal?.addEventListener("abort", pump);
    pump();
  });
}

/**
 * Runs one write call (an Action button). It reads its placeholders from the typed inputs and from `prior`
 * results of the last lookup. On a marked (coloured) environment the call is sent only when `confirm` says yes.
 */
export async function runWriteCall(tool: Tool, callId: string, rawInputs: Record<string, string>, ctx: WriteCallContext): Promise<CallResult> {
  const call = tool.calls.find((c) => c.id === callId);
  if (!call) throw new ToolNotRunnableError("That call is not part of this tool.");
  if (!call.write) throw new ToolNotRunnableError(`${call.name} is a lookup call; it runs from Look up.`);
  const def = ctx.findRequest(call.requestId);
  if (!def) return skipped(call, "missing-request", "Request missing");
  const byId = new Map(tool.calls.map((c) => [c.id, c]));
  const r = resolvePlaceholders(call, def, resolveInputs(tool, rawInputs), byId, ctx.prior ?? {});
  if (r.missing.length > 0) return skipped(call, "needs-value", needsMessage(r));
  const guard = writeCallGuard(ctx.environment);
  if (guard) {
    const ok = ctx.confirm ? await ctx.confirm(guard, call) : false;
    if (!ok) return skipped(call, "not-confirmed", `Not sent: ${guard.name} needs confirming first.`);
  }
  if (ctx.signal?.aborted) return stopped(call);
  const result = await sendCall(call, def, r.data, ctx);
  ctx.onCall?.(result);
  return result;
}
