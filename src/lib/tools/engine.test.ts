import { describe, expect, it, vi } from "vitest";
import type { SendFn } from "../batch";
import { newRequest } from "../defaults";
import type { Environment } from "../environments";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import type { PreparedRequest, RequestDef, SendOutcome } from "../types";
import {
  callData,
  MAX_CONCURRENT_CALLS,
  pickRows,
  type PickRowRequest,
  readCallField,
  resolveInputs,
  resolvePlaceholders,
  runLookup,
  runWriteCall,
  ToolNotRunnableError,
  valueText,
  writeCallGuard,
  type LookupContext,
} from "./engine";
import { newCall, newTool } from "./tools";
import type { CallResult, PlaceholderMapping, Tool, ToolCall } from "./types";

type Reply = { status?: number; body?: unknown; delay?: number } | "error";

function server(reply: (req: PreparedRequest) => Reply, defaultDelay = 3) {
  const sent: PreparedRequest[] = [];
  let inFlight = 0;
  let peak = 0;
  const send: SendFn = async (req, signal) => {
    sent.push(req);
    inFlight++;
    peak = Math.max(peak, inFlight);
    const r = reply(req);
    const delay = r !== "error" && r.delay !== undefined ? r.delay : defaultDelay;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      });
    });
    inFlight--;
    const base = { request: req, sentAt: new Date().toISOString() };
    if (signal?.aborted) return { ...base, ok: false, error: "Request cancelled", durationMs: delay } satisfies SendOutcome;
    if (r === "error") return { ...base, ok: false, error: "connection refused", durationMs: delay } satisfies SendOutcome;
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return { ...base, ok: true, response: { status: r.status ?? 200, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: delay } } satisfies SendOutcome;
  };
  return { send, sent, urls: () => sent.map((s) => s.url), peak: () => peak };
}

/** Requests are found by id; the url tells the fake server which one was sent. */
function setup(urls: Record<string, string>, extra: Partial<RequestDef> = {}) {
  const defs = new Map<string, RequestDef>();
  for (const [id, url] of Object.entries(urls)) defs.set(id, { ...newRequest(), id, name: id, url, ...extra });
  return (id: string) => defs.get(id) ?? null;
}

function mk(id: string, requestId: string, mappings: Record<string, PlaceholderMapping> = {}, extra: Partial<ToolCall> = {}): ToolCall {
  return { ...newCall(requestId, id.toUpperCase()), id, mappings, ...extra };
}

function toolOf(calls: ToolCall[], inputs: Tool["inputs"] = []): Tool {
  return { ...newTool("T"), inputs, calls };
}

function ctxOf(findRequest: LookupContext["findRequest"], send: SendFn, extra: Partial<LookupContext> = {}): LookupContext {
  return { findRequest, envVars: {}, send, scripts: inlineScriptRunner, ...extra };
}

const byId = (run: { results: CallResult[] }, id: string) => run.results.find((r) => r.callId === id)!;
const fromInput = (name: string): PlaceholderMapping => ({ input: name });
const fromCall = (callId: string, path: string): PlaceholderMapping => ({ call: { callId, path } });

describe("runLookup: values and order", () => {
  it("sends a call with its input, and hands a field to the call that needs it", async () => {
    const find = setup({ r1: "https://x/sub/{{id}}", r2: "https://x/acct/{{accountId}}" });
    const s = server((req) => (req.url.includes("/sub/") ? { body: { accountId: "A9" } } : { body: { balance: 5 } }));
    const tool = toolOf([mk("a", "r1", { id: fromInput("subscriberId") }), mk("b", "r2", { accountId: fromCall("a", "accountId") })], [{ name: "subscriberId", label: "ID", kind: "text" }]);
    const run = await runLookup(tool, { subscriberId: "S1" }, ctxOf(find, s.send));
    expect(s.urls()).toEqual(["https://x/sub/S1", "https://x/acct/A9"]);
    expect(run.results.map((r) => r.state)).toEqual(["done", "done"]);
    expect(run.inputs).toEqual({ subscriberId: "S1" });
    expect(run.stopped).toBe(false);
    expect(readCallField(tool.calls[1], byId(run, "b"), "balance")).toBe(5);
  });

  it("starts independent calls at once, and a dependent only after its source finished", async () => {
    const find = setup({ r1: "https://x/one", r2: "https://x/two", r3: "https://x/three/{{v}}" });
    const s = server((req) => (req.url.endsWith("/one") ? { body: { v: 1 }, delay: 20 } : { body: {}, delay: 2 }));
    const tool = toolOf([mk("a", "r1"), mk("b", "r2"), mk("c", "r3", { v: fromCall("a", "v") })]);
    const events: string[] = [];
    await runLookup(tool, {}, ctxOf(find, s.send, { onCallStart: (id) => events.push(`start ${id}`), onCall: (r) => events.push(`end ${r.callId}`) }));
    expect(events.slice(0, 2)).toEqual(["start a", "start b"]);
    expect(events.indexOf("end a")).toBeLessThan(events.indexOf("start c"));
    expect(events.indexOf("end b")).toBeLessThan(events.indexOf("end a"));
    expect(s.urls()).toContain("https://x/three/1");
  });

  it("emits each result as it finishes, before the whole lookup is done", async () => {
    const find = setup({ r1: "https://x/slow", r2: "https://x/fast" });
    const s = server((req) => ({ delay: req.url.endsWith("slow") ? 30 : 2 }));
    const seen: string[] = [];
    const run = await runLookup(toolOf([mk("a", "r1"), mk("b", "r2")]), {}, ctxOf(find, s.send, { onCall: (r) => seen.push(r.callId) }));
    expect(seen).toEqual(["b", "a"]);
    expect(run.results.map((r) => r.callId)).toEqual(["a", "b"]);
  });

  it("refuses a loop between calls and sends nothing", async () => {
    const find = setup({ r1: "https://x/{{p}}", r2: "https://x/{{p}}" });
    const s = server(() => ({}));
    const tool = toolOf([mk("a", "r1", { p: fromCall("b", "x") }), mk("b", "r2", { p: fromCall("a", "x") })]);
    await expect(runLookup(tool, {}, ctxOf(find, s.send))).rejects.toThrow(ToolNotRunnableError);
    expect(s.sent).toHaveLength(0);
  });

  it("works through a chain of three, and a diamond", async () => {
    const find = setup({ r1: "https://x/1", r2: "https://x/2/{{p}}", r3: "https://x/3/{{p}}", r4: "https://x/4/{{p}}/{{q}}" });
    const s = server((req) => ({ body: { v: req.url.split("/").pop() } }));
    const tool = toolOf([mk("d", "r4", { p: fromCall("b", "v"), q: fromCall("c", "v") }), mk("b", "r2", { p: fromCall("a", "v") }), mk("c", "r3", { p: fromCall("a", "v") }), mk("a", "r1")]);
    const run = await runLookup(tool, {}, ctxOf(find, s.send));
    expect(run.results.every((r) => r.state === "done")).toBe(true);
    expect(s.urls()[0]).toBe("https://x/1");
    expect(s.urls()[3]).toBe("https://x/4/1/1");
  });

  it("lets the same request appear twice, filled differently", async () => {
    const find = setup({ r1: "https://x/user/{{id}}" });
    const s = server(() => ({}));
    const tool = toolOf([mk("a", "r1", { id: { fixed: "1" } }), mk("b", "r1", { id: { fixed: "2" } })]);
    const run = await runLookup(tool, {}, ctxOf(find, s.send));
    expect(s.urls().sort()).toEqual(["https://x/user/1", "https://x/user/2"]);
    expect(run.results.map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("runLookup: concurrency", () => {
  it("never has more than 6 calls in flight, and finishes all of them", async () => {
    const urls: Record<string, string> = {};
    const calls: ToolCall[] = [];
    for (let i = 0; i < 15; i++) {
      urls[`r${i}`] = `https://x/${i}`;
      calls.push(mk(`c${i}`, `r${i}`));
    }
    const s = server(() => ({ delay: 8 }));
    const run = await runLookup(toolOf(calls), {}, ctxOf(setup(urls), s.send));
    expect(MAX_CONCURRENT_CALLS).toBe(6);
    expect(s.peak()).toBe(6);
    expect(run.results).toHaveLength(15);
    expect(run.results.every((r) => r.state === "done")).toBe(true);
  });

  it("honours a lower limit", async () => {
    const urls: Record<string, string> = {};
    const calls: ToolCall[] = [];
    for (let i = 0; i < 5; i++) {
      urls[`r${i}`] = `https://x/${i}`;
      calls.push(mk(`c${i}`, `r${i}`));
    }
    const s = server(() => ({ delay: 5 }));
    await runLookup(toolOf(calls), {}, ctxOf(setup(urls), s.send, { maxConcurrent: 2 }));
    expect(s.peak()).toBe(2);
  });
});

describe("runLookup: end states", () => {
  it("counts a 4xx or 5xx response as Done", async () => {
    const find = setup({ r1: "https://x/a", r2: "https://x/b" });
    const s = server((req) => (req.url.endsWith("a") ? { status: 404, body: { error: "no" } } : { status: 503, body: "oops" }));
    const run = await runLookup(toolOf([mk("a", "r1"), mk("b", "r2")]), {}, ctxOf(find, s.send));
    expect(run.results.map((r) => [r.state, r.status])).toEqual([["done", 404], ["done", 503]]);
  });

  it("hands fields on from a 404 body if the path is there", async () => {
    const find = setup({ r1: "https://x/a", r2: "https://x/b/{{e}}" });
    const s = server((req) => (req.url.endsWith("a") ? { status: 404, body: { code: "E7" } } : {}));
    const run = await runLookup(toolOf([mk("a", "r1"), mk("b", "r2", { e: fromCall("a", "code") })]), {}, ctxOf(find, s.send));
    expect(s.urls()).toContain("https://x/b/E7");
    expect(byId(run, "b").state).toBe("done");
  });

  it("reports a network error with its text, and skips what needed it", async () => {
    const find = setup({ r1: "https://x/a", r2: "https://x/b/{{id}}" });
    const s = server((req) => (req.url.endsWith("a") ? "error" : {}));
    const run = await runLookup(toolOf([mk("a", "r1"), mk("b", "r2", { id: fromCall("a", "id") })]), {}, ctxOf(find, s.send));
    const a = byId(run, "a");
    expect(a.state).toBe("network-error");
    expect(a.error).toBe("connection refused");
    expect(a.response).toBeUndefined();
    const b = byId(run, "b");
    expect(b.state).toBe("skipped");
    expect(b.reason).toBe("needs-value");
    expect(b.message).toBe("Needs id from A");
    expect(s.sent).toHaveLength(1);
  });

  it("skips downstream calls when the path is empty, and keeps skipping down the chain", async () => {
    const find = setup({ r1: "https://x/a", r2: "https://x/b/{{id}}", r3: "https://x/c/{{id}}" });
    const s = server(() => ({ body: { other: 1, blank: "", nothing: null } }));
    for (const path of ["id", "blank", "nothing", "x.y"]) {
      s.sent.length = 0;
      const tool = toolOf([mk("a", "r1"), mk("b", "r2", { id: fromCall("a", path) }), mk("c", "r3", { id: fromCall("b", "id") })]);
      const run = await runLookup(tool, {}, ctxOf(find, s.send));
      expect(run.results.map((r) => r.state)).toEqual(["done", "skipped", "skipped"]);
      expect(byId(run, "b").message).toBe("Needs id from A");
      expect(byId(run, "c").message).toBe("Needs id from B");
      expect(s.sent).toHaveLength(1);
    }
  });

  it("skips a call whose response is not JSON when a field is needed", async () => {
    const find = setup({ r1: "https://x/a", r2: "https://x/b/{{id}}" });
    const s = server(() => ({ body: "<html>" }));
    const run = await runLookup(toolOf([mk("a", "r1"), mk("b", "r2", { id: fromCall("a", "id") })]), {}, ctxOf(find, s.send));
    expect(byId(run, "b").state).toBe("skipped");
  });

  it("treats a call that throws as a network error", async () => {
    const find = setup({ r1: "https://x/a" });
    const send: SendFn = async () => {
      throw new Error("boom");
    };
    const run = await runLookup(toolOf([mk("a", "r1")]), {}, ctxOf(find, send));
    expect(run.results[0]).toMatchObject({ state: "network-error", error: "boom" });
  });

  it("does not send when the pre-request script fails, and says why", async () => {
    const find = setup({ r1: "https://x/a" }, { preScript: "throw new Error('nope')" });
    const s = server(() => ({}));
    const run = await runLookup(toolOf([mk("a", "r1")]), {}, ctxOf(find, s.send));
    expect(s.sent).toHaveLength(0);
    expect(run.results[0].state).toBe("network-error");
    expect(run.results[0].error).toContain("pre-request script failed");
  });

  it("runs request scripts, and shows them the mapped values as data", async () => {
    const find = setup({ r1: "https://x/a/{{id}}" }, { preScript: "rr.vars.set('id', rr.data.id + '-scripted')" });
    const s = server(() => ({}));
    await runLookup(toolOf([mk("a", "r1", { id: { fixed: "7" } })]), {}, ctxOf(find, s.send));
    expect(s.urls()).toEqual(["https://x/a/7-scripted"]);
  });
});

describe("runLookup: stop", () => {
  it("marks running calls Stopped, and calls not yet started Stopped too", async () => {
    const find = setup({ r1: "https://x/a", r2: "https://x/b/{{id}}", r3: "https://x/c" });
    const s = server(() => ({ delay: 200 }));
    const ac = new AbortController();
    const tool = toolOf([mk("a", "r1"), mk("b", "r2", { id: fromCall("a", "id") }), mk("c", "r3")]);
    const p = runLookup(tool, {}, ctxOf(find, s.send, { signal: ac.signal }));
    setTimeout(() => ac.abort(), 15);
    const run = await p;
    expect(run.stopped).toBe(true);
    expect(run.results.map((r) => r.state)).toEqual(["stopped", "stopped", "stopped"]);
    expect(s.sent).toHaveLength(2);
  });

  it("does not send anything when already stopped", async () => {
    const find = setup({ r1: "https://x/a" });
    const s = server(() => ({}));
    const ac = new AbortController();
    ac.abort();
    const run = await runLookup(toolOf([mk("a", "r1")]), {}, ctxOf(find, s.send, { signal: ac.signal }));
    expect(s.sent).toHaveLength(0);
    expect(run.results[0].state).toBe("stopped");
    expect(run.stopped).toBe(true);
  });

  it("keeps calls that finished before Stop as they were", async () => {
    const find = setup({ r1: "https://x/fast", r2: "https://x/slow" });
    const s = server((req) => ({ delay: req.url.endsWith("fast") ? 2 : 300 }));
    const ac = new AbortController();
    const p = runLookup(toolOf([mk("a", "r1"), mk("b", "r2")]), {}, ctxOf(find, s.send, { signal: ac.signal }));
    setTimeout(() => ac.abort(), 40);
    const run = await p;
    expect(run.results.map((r) => r.state)).toEqual(["done", "stopped"]);
  });
});

describe("runLookup: missing request, write calls", () => {
  it("shows Request missing and skips it, and what needs it", async () => {
    const find = setup({ r2: "https://x/b/{{id}}", r3: "https://x/c" });
    const s = server(() => ({}));
    const tool = toolOf([mk("a", "deleted"), mk("b", "r2", { id: fromCall("a", "id") }), mk("c", "r3")]);
    const run = await runLookup(tool, {}, ctxOf(find, s.send));
    expect(byId(run, "a")).toMatchObject({ state: "skipped", reason: "missing-request", message: "Request missing" });
    expect(byId(run, "b").state).toBe("skipped");
    expect(byId(run, "c").state).toBe("done");
    expect(s.urls()).toEqual(["https://x/c"]);
  });

  it("never runs write calls in Look up, and leaves them out of the results", async () => {
    const find = setup({ r1: "https://x/a", r2: "https://x/w/{{id}}", r3: "https://x/after/{{id}}" });
    const s = server(() => ({ body: { id: "1" } }));
    const tool = toolOf([mk("a", "r1"), mk("w", "r2", { id: fromCall("a", "id") }, { write: true }), mk("n", "r3", { id: fromCall("w", "id") })]);
    const run = await runLookup(tool, {}, ctxOf(find, s.send));
    expect(s.urls()).toEqual(["https://x/a"]);
    expect(run.results.map((r) => r.callId)).toEqual(["a", "n"]);
    expect(byId(run, "n")).toMatchObject({ state: "skipped", message: "Needs id from W" });
  });
});

describe("placeholder resolution order", () => {
  const def = (url: string): RequestDef => ({ ...newRequest(), url });
  const source = mk("src", "r0");
  const results = new Map<string, CallResult>([["src", { callId: "src", name: "SRC", state: "done", status: 200, response: { status: 200, statusText: "", headers: [], body: '{"v":"fromcall"}', sizeBytes: 0, durationMs: 0 } }]]);
  const resolve = (m: PlaceholderMapping, inputs: Record<string, string> = {}, res = results) =>
    resolvePlaceholders({ ...mk("x", "r"), mappings: { p: m } }, def("https://x/{{p}}"), inputs, new Map([["src", source]]), res);

  it("takes the input first", () => {
    expect(resolve({ input: "i", call: { callId: "src", path: "v" }, fixed: "fixed" }, { i: "typed" }).data.p).toBe("typed");
  });

  it("then the other call's field", () => {
    expect(resolve({ input: "i", call: { callId: "src", path: "v" }, fixed: "fixed" }, { i: "" }).data.p).toBe("fromcall");
  });

  it("then the fixed value", () => {
    expect(resolve({ input: "i", call: { callId: "src", path: "nope" }, fixed: "fixed" }).data.p).toBe("fixed");
    expect(resolve({ fixed: "fixed" }).data.p).toBe("fixed");
  });

  it("reports a missing call field instead of using the environment", () => {
    const r = resolve({ call: { callId: "src", path: "nope" } });
    expect(r.data).toEqual({});
    expect(r.missing).toEqual([{ placeholder: "p", callName: "SRC" }]);
  });

  it("leaves unmapped placeholders to the environment", async () => {
    const find = setup({ r1: "{{base}}/u/{{id}}" });
    const s = server(() => ({}));
    await runLookup(toolOf([mk("a", "r1", { id: { fixed: "5" } })]), {}, ctxOf(find, s.send, { envVars: { base: "https://env.test", id: "ignored" } }));
    expect(s.urls()).toEqual(["https://env.test/u/5"]);
  });

  it("uses a typed input over a same-named environment variable, and an input default when empty", async () => {
    const find = setup({ r1: "https://x/{{id}}" });
    const s = server(() => ({}));
    const tool = toolOf([mk("a", "r1", { id: fromInput("id") })], [{ name: "id", label: "ID", kind: "text", default: "dflt" }]);
    await runLookup(tool, { id: "typed" }, ctxOf(find, s.send, { envVars: { id: "env" } }));
    await runLookup(tool, {}, ctxOf(find, s.send, { envVars: { id: "env" } }));
    expect(s.urls()).toEqual(["https://x/typed", "https://x/dflt"]);
  });

  it("sends an unmapped, unknown placeholder as it is, like Requests", async () => {
    const find = setup({ r1: "https://x/{{nothing}}" });
    const s = server(() => ({}));
    await runLookup(toolOf([mk("a", "r1")]), {}, ctxOf(find, s.send));
    expect(s.urls()[0]).toContain("nothing");
  });

  it("uses a call's data in the body and headers too", async () => {
    const find = setup({ r1: "https://x/a" });
    const defs = find("r1")!;
    defs.method = "GET";
    defs.headers = [{ id: "h", key: "X-Id", value: "{{id}}", enabled: true }];
    const s = server(() => ({}));
    await runLookup(toolOf([mk("a", "r1", { id: { fixed: "H1" } })]), {}, ctxOf(find, s.send));
    expect(s.sent[0].headers).toContainEqual(["X-Id", "H1"]);
  });
});

describe("valueText and resolveInputs", () => {
  it("turns values into text, and nothing into null", () => {
    expect(valueText("a")).toBe("a");
    expect(valueText(12)).toBe("12");
    expect(valueText(0)).toBe("0");
    expect(valueText(false)).toBe("false");
    expect(valueText({ a: 1 })).toBe('{"a":1}');
    expect([undefined, null, ""].map(valueText)).toEqual([null, null, null]);
  });

  it("fills empty inputs from their defaults and ignores unknown ones", () => {
    const tool = toolOf([], [{ name: "a", label: "", kind: "text", default: "d" }, { name: "b", label: "", kind: "text" }]);
    expect(resolveInputs(tool, { a: "", b: "x", z: "y" })).toEqual({ a: "d", b: "x" });
  });
});

describe("pick a row", () => {
  const rows = { items: [{ id: "r0", acct: "A0" }, { id: "r1", acct: "A1" }, { id: "r2", acct: "A2" }] };
  const pickCall = (extra: Partial<ToolCall> = {}) => mk("a", "r1", {}, { pickRow: { listPath: "items", labelPath: "id" }, ...extra });

  it("pauses the calls that need the row until one is chosen, and uses the chosen row's fields", async () => {
    const find = setup({ r1: "https://x/list", r2: "https://x/acct/{{acct}}", r3: "https://x/other" });
    const s = server((req) => (req.url.endsWith("list") ? { body: rows } : {}));
    let release: (n: number | null) => void = () => {};
    const asked = vi.fn((_req: PickRowRequest) => new Promise<number | null>((r) => (release = r)));
    const tool = toolOf([pickCall(), mk("b", "r2", { acct: fromCall("a", "acct") }), mk("c", "r3")]);
    const p = runLookup(tool, {}, ctxOf(find, s.send, { pickRow: asked }));
    await vi.waitFor(() => expect(asked).toHaveBeenCalled());
    // The independent call carried on, the dependent one is waiting.
    await vi.waitFor(() => expect(s.urls()).toContain("https://x/other"));
    expect(s.urls()).not.toContain("https://x/acct/A1");
    const req = asked.mock.calls[0][0];
    expect(req.rows).toHaveLength(3);
    expect(req.result.rowCount).toBe(3);
    release(1);
    const run = await p;
    expect(s.urls()).toContain("https://x/acct/A1");
    expect(byId(run, "a").picked).toEqual({ index: 1 });
    expect(callData(tool.calls[0], byId(run, "a"))).toEqual({ id: "r1", acct: "A1" });
    expect(pickRows(tool.calls[0], byId(run, "a"))).toHaveLength(3);
  });

  it("does not hold a concurrency slot while waiting", async () => {
    const urls: Record<string, string> = { r1: "https://x/list" };
    const calls: ToolCall[] = [pickCall()];
    for (let i = 0; i < 7; i++) {
      urls[`o${i}`] = `https://x/o/${i}`;
      calls.push(mk(`o${i}`, `o${i}`));
    }
    const s = server((req) => (req.url.endsWith("list") ? { body: rows } : { delay: 5 }));
    let release: (n: number | null) => void = () => {};
    const p = runLookup(toolOf(calls), {}, ctxOf(setup(urls), s.send, { pickRow: () => new Promise((r) => (release = r)) }));
    await vi.waitFor(() => expect(s.sent).toHaveLength(8));
    release(0);
    await p;
  });

  it("skips what needs the row when none is chosen", async () => {
    const find = setup({ r1: "https://x/list", r2: "https://x/acct/{{acct}}" });
    const s = server(() => ({ body: rows }));
    const tool = toolOf([pickCall(), mk("b", "r2", { acct: fromCall("a", "acct") })]);
    const run = await runLookup(tool, {}, ctxOf(find, s.send, { pickRow: async () => null }));
    expect(byId(run, "a")).toMatchObject({ state: "done", rowCount: 3 });
    expect(byId(run, "a").picked).toBeUndefined();
    expect(byId(run, "b")).toMatchObject({ state: "skipped", message: "Needs acct from A" });
  });

  it("ignores an index that is not a row", async () => {
    const find = setup({ r1: "https://x/list" });
    const s = server(() => ({ body: rows }));
    const run = await runLookup(toolOf([pickCall()]), {}, ctxOf(find, s.send, { pickRow: async () => 9 }));
    expect(run.results[0].picked).toBeUndefined();
  });

  it("uses the first row when nothing is there to ask", async () => {
    const find = setup({ r1: "https://x/list" });
    const s = server(() => ({ body: rows }));
    const run = await runLookup(toolOf([pickCall()]), {}, ctxOf(find, s.send));
    expect(run.results[0].picked).toEqual({ index: 0 });
  });

  it("does not ask when the list is empty or the response has no list", async () => {
    const find = setup({ r1: "https://x/list", r2: "https://x/acct/{{acct}}" });
    for (const body of [{ items: [] }, { items: "nope" }, "text"]) {
      const s = server(() => ({ body }));
      const asked = vi.fn(async () => 0);
      const tool = toolOf([pickCall(), mk("b", "r2", { acct: fromCall("a", "acct") })]);
      const run = await runLookup(tool, {}, ctxOf(find, s.send, { pickRow: asked }));
      expect(asked).not.toHaveBeenCalled();
      expect(byId(run, "a").state).toBe("done");
      expect(byId(run, "b").state).toBe("skipped");
    }
  });

  it("reads the list from the response itself for $ or an empty path", async () => {
    const find = setup({ r1: "https://x/list", r2: "https://x/acct/{{id}}" });
    const s = server((req) => (req.url.endsWith("list") ? { body: [{ id: "q" }, { id: "w" }] } : {}));
    const tool = toolOf([mk("a", "r1", {}, { pickRow: { listPath: "$", labelPath: "" } }), mk("b", "r2", { id: fromCall("a", "id") })]);
    await runLookup(tool, {}, ctxOf(find, s.send, { pickRow: async () => 1 }));
    expect(s.urls()).toContain("https://x/acct/w");
  });

  it("gives up waiting for a row when Stop is pressed", async () => {
    const find = setup({ r1: "https://x/list", r2: "https://x/acct/{{acct}}" });
    const s = server(() => ({ body: rows }));
    const ac = new AbortController();
    const tool = toolOf([pickCall(), mk("b", "r2", { acct: fromCall("a", "acct") })]);
    const p = runLookup(tool, {}, ctxOf(find, s.send, { signal: ac.signal, pickRow: () => new Promise(() => {}) }));
    setTimeout(() => ac.abort(), 30);
    const run = await p;
    expect(run.stopped).toBe(true);
    expect(byId(run, "b").state).toBe("stopped");
  });

  it("treats a failing pick callback as no row", async () => {
    const find = setup({ r1: "https://x/list" });
    const s = server(() => ({ body: rows }));
    const run = await runLookup(toolOf([pickCall()]), {}, ctxOf(find, s.send, { pickRow: async () => Promise.reject(new Error("x")) }));
    expect(run.results[0].picked).toBeUndefined();
  });
});

describe("runWriteCall", () => {
  const write = (extra: Partial<ToolCall> = {}) => mk("w", "r2", { id: fromCall("a", "id"), note: fromInput("note") }, { write: true, ...extra });
  const defs = () => setup({ r1: "https://x/a", r2: "https://x/suspend/{{id}}?n={{note}}" }, {});
  const tool = () => toolOf([mk("a", "r1"), write()], [{ name: "note", label: "", kind: "text" }]);
  const prior = (id: string): Record<string, CallResult> => ({
    a: { callId: "a", name: "A", state: "done", status: 200, response: { status: 200, statusText: "", headers: [], body: JSON.stringify({ id }), sizeBytes: 0, durationMs: 0 } },
  });
  const env = (color: Environment["color"]): Environment => ({ id: "e", name: "Prod", vars: [], color });

  it("sends the write call with inputs and the last lookup's fields", async () => {
    const s = server(() => ({ status: 201 }));
    const onCall = vi.fn();
    const r = await runWriteCall(tool(), "w", { note: "hi" }, { findRequest: defs(), envVars: {}, send: s.send, scripts: inlineScriptRunner, prior: prior("77"), onCall });
    expect(r).toMatchObject({ state: "done", status: 201 });
    expect(s.urls()).toEqual(["https://x/suspend/77?n=hi"]);
    expect(onCall).toHaveBeenCalledWith(r);
  });

  it("skips when a needed value from the lookup is missing", async () => {
    const s = server(() => ({}));
    const r = await runWriteCall(tool(), "w", {}, { findRequest: defs(), envVars: {}, send: s.send, scripts: inlineScriptRunner });
    expect(r).toMatchObject({ state: "skipped", reason: "needs-value", message: "Needs id from A" });
    expect(s.sent).toHaveLength(0);
  });

  it("does not send to a marked environment unless confirmed", async () => {
    const s = server(() => ({}));
    const base = { findRequest: defs(), envVars: {}, send: s.send, scripts: inlineScriptRunner, prior: prior("1"), environment: env("red") };
    expect(writeCallGuard(env("red"))?.name).toBe("Prod");
    expect(writeCallGuard(env("none"))).toBeNull();
    expect(writeCallGuard(null)).toBeNull();

    const noConfirm = await runWriteCall(tool(), "w", {}, base);
    expect(noConfirm).toMatchObject({ state: "skipped", reason: "not-confirmed" });
    const no = await runWriteCall(tool(), "w", {}, { ...base, confirm: async () => false });
    expect(no.reason).toBe("not-confirmed");
    expect(s.sent).toHaveLength(0);

    const confirm = vi.fn(async (_guard: unknown, _call: ToolCall) => true);
    const yes = await runWriteCall(tool(), "w", {}, { ...base, confirm });
    expect(yes.state).toBe("done");
    expect(confirm.mock.calls[0][1].id).toBe("w");
    expect(s.sent).toHaveLength(1);
  });

  it("asks for no confirmation on an unmarked environment", async () => {
    const s = server(() => ({}));
    const confirm = vi.fn(async () => false);
    const r = await runWriteCall(tool(), "w", {}, { findRequest: defs(), envVars: {}, send: s.send, scripts: inlineScriptRunner, prior: prior("1"), environment: env("none"), confirm });
    expect(r.state).toBe("done");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses lookup calls and unknown calls, and reports a missing request", async () => {
    const s = server(() => ({}));
    const ctx = { findRequest: defs(), envVars: {}, send: s.send, scripts: inlineScriptRunner };
    await expect(runWriteCall(tool(), "a", {}, ctx)).rejects.toThrow(ToolNotRunnableError);
    await expect(runWriteCall(tool(), "zzz", {}, ctx)).rejects.toThrow(ToolNotRunnableError);
    const gone = toolOf([mk("w", "deleted", {}, { write: true })]);
    expect(await runWriteCall(gone, "w", {}, ctx)).toMatchObject({ state: "skipped", reason: "missing-request" });
  });

  it("reports a network error and a stop", async () => {
    const find = setup({ r2: "https://x/w" });
    const t = toolOf([mk("w", "r2", {}, { write: true })]);
    const s = server(() => "error");
    expect((await runWriteCall(t, "w", {}, { findRequest: find, envVars: {}, send: s.send, scripts: inlineScriptRunner })).state).toBe("network-error");
    const ac = new AbortController();
    const slow = server(() => ({ delay: 100 }));
    const p = runWriteCall(t, "w", {}, { findRequest: find, envVars: {}, send: slow.send, scripts: inlineScriptRunner, signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    expect((await p).state).toBe("stopped");
  });
});
