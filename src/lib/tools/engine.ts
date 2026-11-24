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
import { callNeeds, eachPlan, findList, isEachMapping, itemLabel, itemNoun, listAskNeeds, listsToAsk, MAX_EACH_ITEMS, pickOf, readEachItems, readList, readListValue, valueText, type EachPlan, type ListSource, type Need, type ValueResolver } from "./lists";
import { orderCalls } from "./order";
import type { CallResult, EachResult, ListPick, ListRef, LookupRun, PlaceholderMapping, Tool, ToolCall, ToolList } from "./types";

export { valueText };
export { MAX_EACH_ITEMS };

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

export interface PickItemRequest {
  call: ToolCall;
  list: ToolList;
  /** The finished call, with the response the items came from and the picks made so far. */
  result: CallResult;
  items: unknown[];
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
  /**
   * Asked for each list of a call whose rule is "ask" (all lists of one call at once). A call with lists finishes as soon
   * as its response is in; only the calls that read an asked list wait for the answer. Resolve with the chosen index, or
   * null for none (the calls that need it are skipped). Without this, the first item is used.
   */
  pickItem?: (request: PickItemRequest) => Promise<number | null>;
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

/** The same result with one more list pick. The parsed body is kept, so it is not parsed again. */
export function withPick(result: CallResult, listId: string, pick: ListPick): CallResult {
  return withPicks(result, { ...result.picks, [listId]: pick });
}

/** The same result with exactly these list picks (none removes the field). The parsed body is kept. */
export function withPicks(result: CallResult, picks: Record<string, ListPick>): CallResult {
  const { picks: _old, ...rest } = result;
  const next: CallResult = Object.keys(picks).length > 0 ? { ...rest, picks } : rest;
  if (jsonCache.has(result)) jsonCache.set(next, jsonCache.get(result));
  return next;
}

/** A "where" value that knows only fixed text. What a view uses when it has no inputs or other calls to look at. */
export const FIXED_ONLY: ValueResolver = (m) => (m.fixed !== undefined && m.fixed !== "" ? m.fixed : null);

/** What list functions need to read a finished call's lists. */
export function listSource(call: ToolCall, result: CallResult, resolve: ValueResolver = FIXED_ONLY): ListSource {
  // A pick-a-row call that was converted to one list keeps its old lookups readable: its saved `picked` is that list's pick.
  const picks = result.picks ?? (result.picked && call.lists?.length === 1 ? { [call.lists[0].id]: { index: result.picked.index } } : undefined);
  return { call, json: callJson(result), picks, resolve };
}

/**
 * A field of a finished call, or undefined. Blocks read their fields with this.
 * With `list`, the path is read from an item of one of the call's lists (`resolve` supplies the value a "where" rule compares with).
 */
export function readCallField(call: ToolCall, result: CallResult | undefined, path: string, list?: ListRef, resolve?: ValueResolver): unknown {
  if (list) {
    if (!result || result.state !== "done") return undefined;
    const r = readListValue(listSource(call, result, resolve), path, list);
    return r.ok ? r.value : undefined;
  }
  return readPath(callData(call, result), path);
}

// ---- placeholders ----

export interface Resolution {
  /** Values for the mapped placeholders. Unmapped ones are left to the environment. */
  data: Vars;
  /** Placeholders that map to a call field with no value. `reason` says why when a list could not give one ("Customer has no devices"). */
  missing: { placeholder: string; callName: string; reason?: string }[];
}

type Results = ReadonlyMap<string, CallResult> | Record<string, CallResult>;

function resultGetter(results: Results): (id: string) => CallResult | undefined {
  return (id) => (results instanceof Map ? results.get(id) : (results as Record<string, CallResult>)[id]);
}

/** Where values come from while resolving one mapping. */
interface MappingEnv {
  inputs: Record<string, string>;
  calls: ReadonlyMap<string, ToolCall>;
  get: (id: string) => CallResult | undefined;
}

const MAX_MAPPING_DEPTH = 8;

/** One mapping's text, in the order: the input (when it has text), another call's field, the fixed value. Null when none gives one. */
function readMapping(m: PlaceholderMapping, env: MappingEnv, depth = 0): { value: string | null; reason?: string } {
  if (depth > MAX_MAPPING_DEPTH) return { value: null };
  const fromInput = m.input !== undefined ? valueText(env.inputs[m.input]) : null;
  if (fromInput !== null) return { value: fromInput };
  let reason: string | undefined;
  if (m.call) {
    const source = env.calls.get(m.call.callId);
    const result = env.get(m.call.callId);
    if (source && m.call.list) {
      if (result && result.state === "done") {
        const resolve: ValueResolver = (inner) => readMapping(inner, env, depth + 1).value;
        const r = readListValue(listSource(source, result, resolve), m.call.path, m.call.list);
        if (r.ok) {
          const v = valueText(r.value);
          if (v !== null) return { value: v };
        } else reason = r.message;
      }
    } else if (source) {
      const v = valueText(readCallField(source, result, m.call.path));
      if (v !== null) return { value: v };
    }
  }
  if (m.fixed !== undefined && m.fixed !== "") return { value: m.fixed };
  return { value: null, ...(reason ? { reason } : {}) };
}

/** What a "where" rule compares with: resolved the way a placeholder is, from the typed inputs and the finished calls. */
export function valueResolver(tool: Tool, inputs: Record<string, string>, results: Results): ValueResolver {
  const env: MappingEnv = { inputs, calls: new Map(tool.calls.map((c) => [c.id, c])), get: resultGetter(results) };
  return (m) => readMapping(m, env, 1).value;
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
  results: Results,
): Resolution {
  const env: MappingEnv = { inputs, calls, get: resultGetter(results) };
  const data: Vars = {};
  const missing: Resolution["missing"] = [];
  for (const placeholder of requestPlaceholders(def)) {
    const m = call.mappings[placeholder];
    if (!m) continue;
    // A value that reads "each item" is filled one item at a time by the engine.
    if (isEachMapping(m)) continue;
    const r = readMapping(m, env);
    if (r.value !== null) {
      data[placeholder] = r.value;
      continue;
    }
    if (m.call) missing.push({ placeholder, callName: calls.get(m.call.callId)?.name || "a removed call", ...(r.reason ? { reason: r.reason } : {}) });
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
  return [...new Set(r.missing.map((m) => m.reason ?? `Needs ${m.placeholder} from ${m.callName}`))].join("; ");
}

/** Sends one call whose values are ready. Never throws. `announce` false: the caller reports the start itself (a call that runs once per item announces once). */
async function sendCall(call: ToolCall, def: RequestDef, data: Vars, ctx: ToolRunContext, announce = true): Promise<CallResult> {
  if (announce) ctx.onCallStart?.(call.id);
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

// ---- a call that runs once per item ----

/** One item a per-item call runs for: its place in the list, its label, and the value for the call's placeholder (null: the item has none). */
interface EachEntry {
  index: number;
  key?: string;
  value: string | null;
}

type EachPrep = { ok: true; entries: EachEntry[]; total: number; plan: EachPlan; noun: string } | { ok: false; message: string };

/** The items a per-item call runs for, read from the finished call that owns the list. At most MAX_EACH_ITEMS. */
function prepareEach(plan: EachPlan, calls: ReadonlyMap<string, ToolCall>, get: (id: string) => CallResult | undefined, resolve: ValueResolver): EachPrep {
  const source = calls.get(plan.sourceId);
  const result = get(plan.sourceId);
  if (!source) return { ok: false, message: `Needs ${plan.placeholder} from a removed call` };
  if (!result || result.state !== "done") return { ok: false, message: `Needs ${plan.placeholder} from ${source.name}` };
  const list = findList(source, plan.listId);
  if (!list) return { ok: false, message: `${source.name}: a list that was removed is still used` };
  const read = readEachItems(listSource(source, result, resolve), plan.listId);
  if (!read.ok) return { ok: false, message: read.message };
  const entries = read.items.slice(0, MAX_EACH_ITEMS).map((item, index): EachEntry => {
    const key = itemLabel(list, item);
    return { index, ...(key ? { key } : {}), value: valueText(readPath(item, plan.path)) };
  });
  return { ok: true, entries, total: read.items.length, plan, noun: itemNoun(list) };
}

function pendingEach(e: EachEntry, plan: EachPlan, noun: string): EachResult {
  const base = { index: e.index, ...(e.key ? { key: e.key } : {}) };
  if (e.value === null) return { ...base, state: "skipped", reason: "needs-value", message: `No value for {{${plan.placeholder}}} in this ${noun}` };
  return { ...base, state: "pending" };
}

function eachFrom(e: EachEntry, r: CallResult): EachResult {
  const { callId: _id, name: _name, picks: _p, each: _e, eachTotal: _t, rowCount: _r, picked: _pk, ...rest } = r;
  return { ...rest, index: e.index, ...(e.key ? { key: e.key } : {}) };
}

function stoppedEach(e: EachEntry): EachResult {
  return { index: e.index, ...(e.key ? { key: e.key } : {}), state: "stopped", message: "Stopped before this item was sent." };
}

/**
 * The answer of a call that runs once per item: one entry per item. The call's own state says whether anything was
 * answered ("done" when at least one item got a response), so the lookup carries on; the entries hold the detail.
 */
function eachAnswer(call: ToolCall, results: EachResult[], total: number, sentAt: string, startedMs: number): CallResult {
  return withEachState({ callId: call.id, name: call.name, state: "skipped", each: results, eachTotal: total, sentAt, durationMs: Math.max(0, Date.now() - startedMs) });
}

/** The same per-item answer with its own state, error and message worked out again from its items. */
function withEachState(r: CallResult): CallResult {
  const results = r.each ?? [];
  const sentOnes = results.filter((x) => x.state === "done" || x.state === "network-error");
  const state: CallResult["state"] = results.some((x) => x.state === "done") ? "done" : results.some((x) => x.state === "stopped") ? "stopped" : sentOnes.length > 0 ? "network-error" : "skipped";
  const { error: _e, message: _m, ...rest } = r;
  const out: CallResult = { ...rest, state };
  if (state === "network-error") out.error = "No response for any item";
  if (state === "skipped") out.message = results[0]?.message ?? "Nothing to send";
  if (state === "stopped") out.message = "Stopped.";
  return out;
}

/** The same per-item answer with one item's answer put in its place. */
export function withEachResult(result: CallResult, entry: EachResult): CallResult {
  const each = [...(result.each ?? []).filter((e) => e.index !== entry.index), entry].sort((a, b) => a.index - b.index);
  return withEachState({ ...result, each });
}

/** Whether an item's answer is a failure (no response, or an error status). */
export function eachFailed(r: EachResult): boolean {
  return r.state === "network-error" || (r.state === "done" && (r.status ?? r.response?.status ?? 0) >= 400);
}

/** Runs a per-item call for every item, a few at a time, when it runs on its own (Retry), not inside a lookup. */
async function runEachAlone(call: ToolCall, def: RequestDef, plan: EachPlan, base: Vars, prep: Extract<EachPrep, { ok: true }>, ctx: ToolRunContext): Promise<CallResult> {
  const sentAt = new Date().toISOString();
  const startedMs = Date.now();
  const results = prep.entries.map((e) => pendingEach(e, plan, prep.noun));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= prep.entries.length) return;
      const e = prep.entries[i];
      if (e.value === null) continue;
      if (ctx.signal?.aborted) {
        results[i] = stoppedEach(e);
        continue;
      }
      results[i] = eachFrom(e, await sendCall(call, def, { ...base, [plan.placeholder]: e.value }, ctx, false));
    }
  };
  ctx.onCallStart?.(call.id);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(ctx.maxConcurrent ?? MAX_CONCURRENT_CALLS, prep.entries.length)) }, worker));
  return eachAnswer(call, results, prep.total, sentAt, startedMs);
}

/** The state a pending item is shown in while its call is still running. */
interface EachRun {
  call: ToolCall;
  def: RequestDef;
  plan: EachPlan;
  base: Vars;
  entries: EachEntry[];
  results: EachResult[];
  total: number;
  /** The next entry to send. */
  next: number;
  inflight: number;
  announced: boolean;
  sentAt: string;
  startedMs: number;
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

  const needsOf = (call: ToolCall): Need[] => {
    const def = ctx.findRequest(call.requestId);
    return callNeeds(call, def ? requestPlaceholders(def) : [], byId).filter((n) => byId.has(n.callId));
  };

  // Calls with lists finish as soon as their response is in. The lists the user is asked to pick in settle later,
  // one at a time, and only the calls that read such a list wait for it.
  const asking = new Map(tool.calls.filter((c) => !c.write && c.lists?.length).map((c) => [c.id, listsToAsk(tool, c)]));
  const settled = new Set<string>();
  const settledKey = (callId: string, listId: string) => `${callId}\u0001${listId}`;
  const isSettled = (callId: string, listId: string) => settled.has(settledKey(callId, listId)) || !asking.get(callId)?.includes(listId);
  const needsMet = (needs: Need[]) => needs.every((n) => !byId.has(n.callId) || (finished.has(n.callId) && n.lists.every((l) => isSettled(n.callId, l))));
  /** Lists of finished calls not yet asked about (call id to list ids). */
  const unasked = new Map<string, Set<string>>();
  let openAsks = 0;
  let askingNow = 0;

  const env: MappingEnv = { inputs, calls: byId, get: (id) => results.get(id) };
  const resolve: ValueResolver = (m) => readMapping(m, env, 1).value;
  /** Calls that run once per item and still have items to send or answers to wait for. */
  const eachRuns = new Map<string, EachRun>();

  return new Promise<LookupRun>((resolveRun) => {
    const settle = (callId: string, listId: string) => {
      const key = settledKey(callId, listId);
      if (settled.has(key)) return;
      settled.add(key);
      openAsks--;
    };

    const finish = (call: ToolCall, result: CallResult | null) => {
      if (result) {
        results.set(call.id, result);
        if (result.state === "stopped") wasStopped = true;
        ctx.onCall?.(result);
      }
      finished.add(call.id);
      const lists = asking.get(call.id) ?? [];
      if (lists.length > 0) {
        openAsks += lists.length;
        if (result?.state === "done") unasked.set(call.id, new Set(lists));
        else lists.forEach((l) => settle(call.id, l));
      }
    };

    const emitEach = (run: EachRun) => {
      const partial = eachAnswer(run.call, [...run.results], run.total, run.sentAt, run.startedMs);
      // Not finished while an item waits: the call shows as running, and a failure of the whole call is not reported yet.
      results.set(run.call.id, { ...partial, state: "done" });
      ctx.onCall?.(results.get(run.call.id)!);
    };

    /** Starts a per-item call: the items are read, and each is sent as a slot becomes free (they share the limit with every other call). */
    const startEach = (call: ToolCall, def: RequestDef, plan: EachPlan, base: Vars): boolean => {
      const prep = prepareEach(plan, byId, (id) => results.get(id), resolve);
      if (!prep.ok) {
        finish(call, skipped(call, "needs-value", prep.message));
        return false;
      }
      started.add(call.id);
      const run: EachRun = { call, def, plan, base, entries: prep.entries, results: prep.entries.map((e) => pendingEach(e, plan, prep.noun)), total: prep.total, next: 0, inflight: 0, announced: false, sentAt: new Date().toISOString(), startedMs: Date.now() };
      eachRuns.set(call.id, run);
      if (prep.entries.some((e) => e.value !== null)) emitEach(run);
      return true;
    };

    const launchItem = (run: EachRun, pos: number) => {
      const e = run.entries[pos];
      running++;
      run.inflight++;
      const announce = !run.announced;
      run.announced = true;
      void (async () => {
        const r = await sendCall(run.call, run.def, { ...run.base, [run.plan.placeholder]: e.value! }, ctx, announce);
        running--;
        run.inflight--;
        run.results[pos] = eachFrom(e, r);
        if (r.state === "stopped") wasStopped = true;
        if (run.next < run.entries.length || run.inflight > 0) emitEach(run);
        pump();
      })();
    };

    /** Sends the next items of every running per-item call while there are free slots, and finishes the calls that have nothing left. */
    const pumpEach = () => {
      for (const run of [...eachRuns.values()]) {
        while (run.next < run.entries.length) {
          const pos = run.next;
          const e = run.entries[pos];
          if (e.value === null) {
            run.next++;
            continue;
          }
          if (ctx.signal?.aborted) {
            run.results[pos] = stoppedEach(e);
            run.next++;
            continue;
          }
          if (running >= max) break;
          run.next++;
          launchItem(run, pos);
        }
        if (run.next >= run.entries.length && run.inflight === 0) {
          eachRuns.delete(run.call.id);
          finish(run.call, eachAnswer(run.call, run.results, run.total, run.sentAt, run.startedMs));
        }
      }
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

    /** Picks an item of one list: asks the user (a list of one item is picked without asking), then lets the calls waiting for it go on. */
    const ask = async (call: ToolCall, listId: string) => {
      askingNow++;
      try {
        // Never run inside pump itself.
        await Promise.resolve();
        const list = findList(call, listId);
        const current = results.get(call.id);
        if (!list || !current) return;
        const read = readList(listSource(call, current, resolve), listId);
        if (!read.ok || read.items.length === 0) return;
        let index: number | null = 0;
        if (ctx.pickItem && !(read.items.length === 1 && list.autoPickSingle !== false)) {
          const abort = abortPromise(ctx.signal);
          try {
            index = await Promise.race([ctx.pickItem({ call, list, result: current, items: read.items }), abort.promise.then(() => null)]);
          } catch {
            index = null;
          } finally {
            abort.dispose();
          }
        }
        if (index === null || !Number.isInteger(index) || index < 0 || index >= read.items.length) return;
        const next = withPick(results.get(call.id) ?? current, listId, pickOf(list, read.items, index));
        results.set(call.id, next);
        ctx.onCall?.(next);
      } finally {
        askingNow--;
        settle(call.id, listId);
        pump();
      }
    };

    /** Starts the picks that can be asked now: a list inside another list waits for its parent's choice. */
    const askReady = () => {
      for (const [callId, pending] of unasked) {
        const call = byId.get(callId)!;
        for (const listId of [...pending]) {
          const aborted = !!ctx.signal?.aborted;
          if (!aborted && !needsMet(listAskNeeds(call, listId, byId))) continue;
          pending.delete(listId);
          if (aborted) settle(callId, listId);
          else void ask(call, listId);
        }
        if (pending.size === 0) unasked.delete(callId);
      }
    };

    const pump = () => {
      let again = true;
      while (again) {
        again = false;
        askReady();
        for (const call of order.order) {
          if (started.has(call.id) || finished.has(call.id)) continue;
          if (!needsMet(needsOf(call))) continue;
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
          const plan = eachPlan(call);
          if (plan) {
            if (!startEach(call, def, plan, r.data)) again = true;
            continue;
          }
          if (running >= max) continue;
          startCall(call, def, r.data);
        }
        const before = finished.size;
        pumpEach();
        if (finished.size > before) again = true;
        // Every call is finished but some pick could never be asked (its rule waits on a pick that waits on it): give those up.
        if (finished.size === tool.calls.length && askingNow === 0 && unasked.size > 0) {
          for (const [callId, pending] of unasked) pending.forEach((l) => settle(callId, l));
          unasked.clear();
        }
      }
      if (!over && finished.size === tool.calls.length && openAsks === 0) {
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
  if (eachPlan(call)) return skipped(call, "invalid", `${call.name} reads each item of a list, so it cannot run from an Action button.`);
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

/** Calls whose values come from this call's response (so a retry of it would leave them out of date). */
export function dependentCalls(tool: Tool, callId: string, findRequest: RequestLookup): ToolCall[] {
  const byId = new Map(tool.calls.map((c) => [c.id, c]));
  return tool.calls.filter((c) => {
    if (c.id === callId) return false;
    const def = findRequest(c.requestId);
    return callNeeds(c, def ? requestPlaceholders(def) : [], byId).some((n) => n.callId === callId);
  });
}

/** Whether Retry can run this one call alone: nothing reads its answer and it is not a pick-a-row call. Otherwise the whole lookup runs again. */
export function canRetryAlone(tool: Tool, callId: string, findRequest: RequestLookup): boolean {
  const call = tool.calls.find((c) => c.id === callId);
  return !!call && !call.write && !call.pickRow && !call.lists?.length && dependentCalls(tool, callId, findRequest).length === 0;
}

/** Runs one lookup call again, reading what it needs from `prior` (the answers on screen). Never throws except for a call that is not a lookup call. */
export async function runLookupCall(tool: Tool, callId: string, rawInputs: Record<string, string>, ctx: ToolRunContext & { prior?: Record<string, CallResult> }): Promise<CallResult> {
  const call = tool.calls.find((c) => c.id === callId);
  if (!call) throw new ToolNotRunnableError("That call is not part of this tool.");
  if (call.write) throw new ToolNotRunnableError(`${call.name} is a write call; it runs from its Action button.`);
  const def = ctx.findRequest(call.requestId);
  if (!def) return skipped(call, "missing-request", "Request missing");
  const byId = new Map(tool.calls.map((c) => [c.id, c]));
  const r = resolvePlaceholders(call, def, resolveInputs(tool, rawInputs), byId, ctx.prior ?? {});
  if (r.missing.length > 0) return skipped(call, "needs-value", needsMessage(r));
  const plan = eachPlan(call);
  if (plan) {
    const inputs = resolveInputs(tool, rawInputs);
    const prior = ctx.prior ?? {};
    const prep = prepareEach(plan, byId, (id) => prior[id], valueResolver(tool, inputs, prior));
    const answer = prep.ok ? await runEachAlone(call, def, plan, r.data, prep, ctx) : skipped(call, "needs-value", prep.message);
    ctx.onCall?.(answer);
    return answer;
  }
  const result = await sendCall(call, def, r.data, ctx);
  ctx.onCall?.(result);
  return result;
}

/**
 * Sends one item of a per-item call again (the Retry of a table cell). Reads the item from `prior`, the answers on
 * screen. Never throws except for a call that is not a per-item lookup call.
 */
export async function runEachItem(tool: Tool, callId: string, index: number, rawInputs: Record<string, string>, ctx: ToolRunContext & { prior?: Record<string, CallResult> }): Promise<EachResult> {
  const call = tool.calls.find((c) => c.id === callId);
  const plan = call ? eachPlan(call) : null;
  if (!call || !plan || call.write) throw new ToolNotRunnableError("That call does not run once per item.");
  const def = ctx.findRequest(call.requestId);
  const byId = new Map(tool.calls.map((c) => [c.id, c]));
  const prior = ctx.prior ?? {};
  const inputs = resolveInputs(tool, rawInputs);
  const prep = prepareEach(plan, byId, (id) => prior[id], valueResolver(tool, inputs, prior));
  const entry = prep.ok ? prep.entries.find((e) => e.index === index) : undefined;
  const base = { index, ...(entry?.key ? { key: entry.key } : {}) };
  if (!def) return { ...base, state: "skipped", reason: "missing-request", message: "Request missing" };
  if (!prep.ok || !entry) return { ...base, state: "skipped", reason: "needs-value", message: prep.ok ? "This item is no longer in the list" : prep.message };
  const r = resolvePlaceholders(call, def, inputs, byId, prior);
  if (r.missing.length > 0) return { ...base, state: "skipped", reason: "needs-value", message: needsMessage(r) };
  if (entry.value === null) return pendingEach(entry, plan, prep.noun);
  return eachFrom(entry, await sendCall(call, def, { ...r.data, [plan.placeholder]: entry.value }, ctx, false));
}
