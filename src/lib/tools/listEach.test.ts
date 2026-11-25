import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import { newRequest } from "../defaults";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import type { PreparedRequest, RequestDef, SendOutcome } from "../types";
import { MAX_CONCURRENT_CALLS, MAX_EACH_ITEMS, canRetryAlone, runEachItem, runLookup, runLookupCall, runWriteCall, type LookupContext } from "./engine";
import { eachFailed } from "./engine";
import { cleanTools, newBlock, newCall, newTool, validateTool } from "./tools";
import { importToolsFile, toToolsFile } from "./toolsFile";
import type { CallResult, PlaceholderMapping, Tool, ToolCall, ToolList } from "./types";
import { callView, lookupAsText, picksText, progressCounts, rawResponseText, statusLabel, tableView } from "./view";

const devices = [
  { serial: "D1", model: "iPhone" },
  { serial: "D2", model: "Pixel" },
  { serial: "D3", model: "iPad" },
];

const requests: Record<string, string> = {
  customer: "https://api/customer",
  warranty: "https://api/warranty/{{serial}}",
  note: "https://api/note?customer={{who}}&serial={{serial}}",
  other: "https://api/other",
};

function find(id: string): RequestDef | null {
  return requests[id] ? { ...newRequest(), id, name: id, url: requests[id] } : null;
}

interface Server {
  send: SendFn;
  urls: string[];
  /** The most requests that were in flight at once. */
  peak: () => number;
}

function server(opts: { devices?: unknown[]; status?: (url: string) => number; fail?: (url: string) => boolean; delay?: number } = {}): Server {
  const urls: string[] = [];
  let inflight = 0;
  let peak = 0;
  const send: SendFn = async (req: PreparedRequest, signal) => {
    urls.push(req.url);
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, opts.delay ?? 3);
      signal?.addEventListener("abort", () => (clearTimeout(t), resolve()));
    });
    inflight--;
    if (opts.fail?.(req.url)) return { request: req, sentAt: "2026-01-01T00:00:00.000Z", ok: false, error: "Connection refused", durationMs: 1 } satisfies SendOutcome;
    const body = req.url === "https://api/customer" ? JSON.stringify({ name: "Ada", devices: opts.devices ?? devices }) : JSON.stringify({ url: req.url, expires: "2027-01-01" });
    const status = opts.status?.(req.url) ?? 200;
    return { request: req, sentAt: "2026-01-01T00:00:00.000Z", ok: true, response: { status, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: 3 } } satisfies SendOutcome;
  };
  return { send, urls, peak: () => peak };
}

const L = (extra: Partial<ToolList> = {}): ToolList => ({ id: "devices", name: "Devices", path: "$.devices", labelPath: "$.model", choose: { kind: "none" }, ...extra });
const mk = (id: string, requestId: string, mappings: Record<string, PlaceholderMapping> = {}, extra: Partial<ToolCall> = {}): ToolCall => ({ ...newCall(requestId, id.toUpperCase()), id, mappings, ...extra });
const each = (callId: string, path: string, listId = "devices"): PlaceholderMapping => ({ call: { callId, path, list: { listId, item: { kind: "each" } } } });

function warrantyTool(extra: Partial<Tool> = {}): Tool {
  return { ...newTool("T"), calls: [mk("c", "customer", {}, { lists: [L()] }), mk("w", "warranty", { serial: each("c", "$.serial") })], ...extra };
}

const run = (tool: Tool, s: { send: SendFn }, extra: Partial<LookupContext> = {}) => runLookup(tool, {}, { findRequest: find, envVars: {}, send: s.send, scripts: inlineScriptRunner, ...extra });
const result = (r: { results: CallResult[] }, id: string) => r.results.find((x) => x.callId === id)!;

describe("a call that runs once per item", () => {
  it("sends one request per item, each with that item's value", async () => {
    const s = server();
    const r = await run(warrantyTool(), s);
    expect(s.urls.sort()).toEqual(["https://api/customer", "https://api/warranty/D1", "https://api/warranty/D2", "https://api/warranty/D3"]);
    const w = result(r, "w");
    expect(w.state).toBe("done");
    expect(w.eachTotal).toBe(3);
    expect(w.each?.map((e) => [e.index, e.key, e.state, e.status])).toEqual([
      [0, "iPhone", "done", 200],
      [1, "Pixel", "done", 200],
      [2, "iPad", "done", 200],
    ]);
    expect(JSON.parse(w.each![1].response!.body).url).toBe("https://api/warranty/D2");
  });

  it("waits for the call that owns the list, and keeps filling the other placeholders of the request", async () => {
    requests.note = "https://api/note?customer={{who}}&serial={{serial}}";
    const tool = warrantyTool();
    tool.inputs = [{ name: "who", label: "Who", kind: "text", default: "ada" }];
    tool.calls[1] = mk("w", "note", { serial: each("c", "$.serial"), who: { input: "who" } });
    const s = server();
    await run(tool, s);
    expect(s.urls[0]).toBe("https://api/customer");
    expect(s.urls.slice(1).sort()).toEqual(["https://api/note?customer=ada&serial=D1", "https://api/note?customer=ada&serial=D2", "https://api/note?customer=ada&serial=D3"]);
  });

  it("shares the 6-request limit with the rest of the lookup", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ serial: `S${i}`, model: `M${i}` }));
    const s = server({ devices: many, delay: 5 });
    const tool = warrantyTool();
    tool.calls.push(mk("o1", "other"), mk("o2", "other"));
    await run(tool, s);
    expect(s.peak()).toBeLessThanOrEqual(MAX_CONCURRENT_CALLS);
    expect(s.urls.filter((u) => u.includes("warranty"))).toHaveLength(20);
  });

  it("stops at 25 items and says how many there were", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ serial: `S${i}`, model: `M${i}` }));
    const s = server({ devices: many });
    const r = await run(warrantyTool(), s);
    const w = result(r, "w");
    expect(w.each).toHaveLength(MAX_EACH_ITEMS);
    expect(w.eachTotal).toBe(40);
    expect(s.urls.filter((u) => u.includes("warranty"))).toHaveLength(25);
  });

  it("an item that fails does not stop the others, and is reported on its own", async () => {
    const s = server({ status: (u) => (u.endsWith("D2") ? 500 : 200), fail: (u) => u.endsWith("D3") });
    const r = await run(warrantyTool(), s);
    const w = result(r, "w");
    expect(w.state).toBe("done");
    expect(w.each!.map((e) => [e.state, eachFailed(e)])).toEqual([["done", false], ["done", true], ["network-error", true]]);
    expect(w.each![2].error).toBe("Connection refused");
    expect(statusLabel(callView({ result: w, sending: false, lookingUp: false }))).toMatch(/2 of 3 failed/);
  });

  it("skips the call when the list is empty, with the reason", async () => {
    const s = server({ devices: [] });
    const r = await run(warrantyTool(), s);
    const w = result(r, "w");
    expect(w.state).toBe("skipped");
    expect(w.message).toBe("C has no devices");
    expect(s.urls).toEqual(["https://api/customer"]);
  });

  it("an item with no value is skipped on its own while the rest go out", async () => {
    const s = server({ devices: [{ serial: "D1", model: "A" }, { model: "B" }, { serial: "D3", model: "C" }] });
    const r = await run(warrantyTool(), s);
    const w = result(r, "w");
    expect(w.each!.map((e) => e.state)).toEqual(["done", "skipped", "done"]);
    expect(w.each![1].message).toMatch(/No value for \{\{serial\}\}/);
    expect(s.urls.filter((u) => u.includes("warranty")).sort()).toEqual(["https://api/warranty/D1", "https://api/warranty/D3"]);
  });

  it("reports each item as it finishes, before the whole call is done", async () => {
    const s = server();
    const seen: number[] = [];
    await run(warrantyTool(), s, { onCall: (r) => r.callId === "w" && seen.push((r.each ?? []).filter((e) => e.state === "pending").length) });
    expect(seen[0]).toBe(3);
    expect(seen.at(-1)).toBe(0);
    expect(seen.length).toBeGreaterThan(2);
  });

  it("announces the call once, however many items it sends", async () => {
    const started: string[] = [];
    await run(warrantyTool(), server(), { onCallStart: (id) => started.push(id) });
    expect(started.filter((id) => id === "w")).toHaveLength(1);
  });

  it("Stop ends the items not yet sent as stopped", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ serial: `S${i}`, model: `M${i}` }));
    const ac = new AbortController();
    const s = server({ devices: many, delay: 20 });
    const p = run(warrantyTool(), s, { signal: ac.signal });
    setTimeout(() => ac.abort(), 35);
    const r = await p;
    expect(r.stopped).toBe(true);
    const w = result(r, "w");
    expect(w.each!.some((e) => e.state === "stopped")).toBe(true);
    expect(w.each!.some((e) => e.state === "pending")).toBe(false);
  });

  it("reads the list inside the chosen item of its parent: each feature of the picked service", async () => {
    const tool = warrantyTool();
    tool.calls[0] = mk("c", "customer", {}, { lists: [L({ id: "services", name: "Services", path: "$.services", choose: { kind: "index", index: 1 } }), L({ id: "features", name: "Features", path: "$.features", parentListId: "services", labelPath: "$.code" })] });
    tool.calls[1] = mk("w", "warranty", { serial: each("c", "$.code", "features") });
    const s = server();
    const base = server();
    const send: SendFn = (req, signal) => (req.url === "https://api/customer" ? base.send(req, signal).then((o) => (o.ok ? { ...o, response: { ...o.response, body: JSON.stringify({ services: [{ features: [{ code: "x" }] }, { features: [{ code: "roam" }, { code: "5g" }] }] }) } } : o)) : s.send(req, signal));
    await run(tool, { send });
    expect(s.urls.sort()).toEqual(["https://api/warranty/5g", "https://api/warranty/roam"]);
  });

  it("a write call cannot run once per item, from an Action button", async () => {
    const tool = warrantyTool();
    tool.calls[1] = { ...tool.calls[1], write: true };
    const out = await runWriteCall(tool, "w", {}, { findRequest: find, envVars: {}, send: server().send, scripts: inlineScriptRunner });
    expect(out.state).toBe("skipped");
    expect(out.reason).toBe("invalid");
  });
});

describe("running a per-item call again", () => {
  it("Retry of the call sends every item again, from the answers on screen", async () => {
    const tool = warrantyTool();
    const first = await run(tool, server());
    const prior = Object.fromEntries(first.results.map((r) => [r.callId, r]));
    const s = server();
    const again = await runLookupCall(tool, "w", {}, { findRequest: find, envVars: {}, send: s.send, scripts: inlineScriptRunner, prior });
    expect(again.each).toHaveLength(3);
    expect(s.urls.sort()).toEqual(["https://api/warranty/D1", "https://api/warranty/D2", "https://api/warranty/D3"]);
    expect(canRetryAlone(tool, "w", find)).toBe(true);
  });

  it("Retry of one item sends only that item", async () => {
    const tool = warrantyTool();
    const first = await run(tool, server({ status: (u) => (u.endsWith("D2") ? 500 : 200) }));
    const prior = Object.fromEntries(first.results.map((r) => [r.callId, r]));
    const s = server();
    const item = await runEachItem(tool, "w", 1, {}, { findRequest: find, envVars: {}, send: s.send, scripts: inlineScriptRunner, prior });
    expect(s.urls).toEqual(["https://api/warranty/D2"]);
    expect(item).toMatchObject({ index: 1, key: "Pixel", state: "done", status: 200 });
  });
});

describe("what a per-item call looks like", () => {
  const tool = (): Tool => ({
    ...warrantyTool(),
    blocks: [newBlock("table", 0, { id: "t", callId: "c", listId: "devices", fields: [{ path: "$.model", label: "Model", format: "text" }, { path: "$.expires", label: "Warranty ends", format: "date", callId: "w" }] })],
  });

  it("a table on the list gets a cell per item from the per-item call", async () => {
    const t = tool();
    const r = await run(t, server({ status: (u) => (u.endsWith("D2") ? 500 : 200) }));
    const results = Object.fromEntries(r.results.map((x) => [x.callId, x]));
    const view = tableView(t.blocks[0], t.calls[0], results.c, undefined, results);
    expect(view.rows.map((row) => row[0])).toEqual(["iPhone", "Pixel", "iPad"]);
    expect(view.rows[0][1]).toMatch(/2027/);
    expect(view.rows[1][1]).toBe("HTTP 500");
    expect(view.cellStatus?.[1][1]).toMatchObject({ kind: "failed", callId: "w", index: 1 });
    expect(view.cellStatus?.[0][1]).toBeNull();
    expect(view.cellStatus?.[0][0]).toBeNull();
  });

  it("a cell shows Running while its item is out, and Waiting before the call starts", async () => {
    const t = tool();
    const r = await run(t, server());
    const c = result(r, "c");
    const waiting = tableView(t.blocks[0], t.calls[0], c, undefined, { c });
    expect(waiting.rows[0][1]).toBe("Waiting");
    const partial: CallResult = { callId: "w", name: "W", state: "done", each: [{ index: 0, state: "pending" }] };
    const running = tableView(t.blocks[0], t.calls[0], c, undefined, { c, w: partial });
    expect(running.rows[0][1]).toBe("Running");
    expect(running.rows[1][1]).toBe("Not run");
    expect(callView({ result: partial, sending: false, lookingUp: true }).kind).toBe("running");
    expect(progressCounts(t, { c, w: partial }, []).done).toBe(1);
  });

  it("copied text lists one entry per item", async () => {
    const t = tool();
    const r = await run(t, server());
    const text = lookupAsText(t, Object.fromEntries(r.results.map((x) => [x.callId, x])), find);
    expect(text).toContain("W · iPhone");
    expect(text).toContain("W · Pixel");
    expect(text).toContain("W · iPad");
    expect(rawResponseText(result(r, "w"))).toContain("iPhone");
    expect(picksText(t.calls[1], result(r, "w"))).toBe("");
  });
});

describe("Build problems", () => {
  const problems = (t: Tool) => validateTool(t, find);

  it("a clean per-item tool has none", () => {
    expect(problems(warrantyTool())).toEqual([]);
  });

  it("only one value of a call may run it once per item", () => {
    const t = warrantyTool();
    t.calls[1] = mk("w", "note", { serial: each("c", "$.serial"), who: each("c", "$.model") });
    expect(problems(t).map((p) => [p.level, p.code])).toContainEqual(["error", "per-item-twice"]);
  });

  it("a write call cannot run once per item", () => {
    const t = warrantyTool();
    t.calls[1] = { ...t.calls[1], write: true };
    expect(problems(t).map((p) => p.code)).toContain("per-item-write");
  });

  it("other calls cannot read from a per-item call", () => {
    const t = warrantyTool();
    t.calls.push(mk("o", "other", { x: { call: { callId: "w", path: "$.expires" } } }));
    const p = problems(t).find((x) => x.code === "reads-per-item")!;
    expect(p.level).toBe("error");
    expect(p.message).toBe("W runs once per device; other calls can't read from it yet");
  });

  it("a column from a call that does not run over the table's list is flagged, and a plain block on a per-item call is warned about", () => {
    const t = warrantyTool();
    t.blocks = [
      newBlock("table", 0, { id: "t", callId: "c", listId: "devices", fields: [{ path: "$.x", label: "X", format: "text", callId: "o" }] }),
      newBlock("fields", 1, { id: "f", callId: "w", fields: [{ path: "$.expires", label: "Ends", format: "text" }] }),
    ];
    t.calls.push(mk("o", "other"));
    const codes = problems(t).map((p) => p.code);
    expect(codes).toContain("per-item-column");
    expect(codes).toContain("per-item-block");
  });
});

describe("saving and exporting", () => {
  const table = (): Tool => ({
    ...warrantyTool(),
    blocks: [newBlock("table", 0, { id: "t", callId: "c", listId: "devices", fields: [{ path: "$.expires", label: "Ends", format: "date", callId: "w" }] })],
  });

  it("cleanTools keeps the each choice and the column's call", () => {
    const [t] = cleanTools(JSON.parse(JSON.stringify([table()])));
    expect(t.calls[1].mappings.serial.call?.list?.item).toEqual({ kind: "each" });
    expect(t.blocks[0].fields[0].callId).toBe("w");
  });

  it("each is accepted only as a call's own value, not in a where or a block field", () => {
    const t = JSON.parse(JSON.stringify(table()));
    t.calls[0].lists[0].choose = { kind: "where", field: "$.a", op: "eq", value: each("c", "$.x") };
    t.blocks[0].fields.push({ path: "$.model", label: "M", format: "text", list: { listId: "devices", item: { kind: "each" } } });
    const [clean] = cleanTools([t]);
    expect(JSON.stringify(clean.calls[0].lists)).not.toContain("each");
    expect(clean.blocks[0].fields[1].list?.item).toBeUndefined();
  });

  it("a tool file that uses it is version 2 and survives a round trip", () => {
    const text = toToolsFile([table()], []);
    expect(JSON.parse(text).version).toBe(2);
    const back = importToolsFile(text, { tools: [], collections: [] });
    expect(back.tools[0].calls[1].mappings.serial.call?.list?.item?.kind).toBe("each");
    expect(back.tools[0].blocks[0].fields[0].callId).toBe("w");
  });
});

describe("ToolSession: retrying one item", () => {
  it("shows the item as running, sends only it, and puts its answer in place without touching the others", async () => {
    const { ToolSession } = await import("./session");
    const session = new ToolSession("t");
    const tool = warrantyTool();
    const first = server({ status: (u) => (u.endsWith("D2") ? 500 : 200) });
    const deps = { findRequest: find, envVars: {}, send: first.send, scripts: inlineScriptRunner, save: async () => true };
    await session.lookup(tool, deps);
    expect(session.getState().results.w.each!.map((e) => eachFailed(e))).toEqual([false, true, false]);

    const second = server({ delay: 25 });
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.getState().results.w.each!.map((e) => e.state[0]).join("")));
    const p = session.retryItem(tool, "w", 1, { ...deps, send: second.send });
    await new Promise((r) => setTimeout(r, 5));
    expect(session.getState().results.w.each![1].state).toBe("pending");
    expect(callView({ result: session.getState().results.w, sending: false, lookingUp: false }).kind).toBe("running");
    await p;
    expect(second.urls).toEqual(["https://api/warranty/D2"]);
    const after = session.getState().results.w;
    expect(after.each!.map((e) => [e.index, e.state, e.status])).toEqual([[0, "done", 200], [1, "done", 200], [2, "done", 200]]);
    expect(callView({ result: after, sending: false, lookingUp: false })).toMatchObject({ kind: "each", failed: 0, sent: 3 });
  });

  it("does nothing while a lookup runs or for an item that does not exist", async () => {
    const { ToolSession } = await import("./session");
    const session = new ToolSession("t");
    const tool = warrantyTool();
    const s = server();
    const deps = { findRequest: find, envVars: {}, send: s.send, scripts: inlineScriptRunner, save: async () => true };
    await session.lookup(tool, deps);
    const before = s.urls.length;
    await session.retryItem(tool, "w", 9, deps);
    expect(s.urls.length).toBe(before);
  });
});

describe("what a call gives", () => {
  it("a column from a per-item call is given by that call, not by the call the table reads", async () => {
    const { callGives } = await import("./builder");
    const t = warrantyTool({ blocks: [newBlock("table", 0, { id: "t", callId: "c", listId: "devices", fields: [{ path: "$.model", label: "Model", format: "text" }, { path: "$.expires", label: "Ends", format: "date", callId: "w" }] })] });
    expect(callGives(t, t.calls[0])).toEqual(["Model", "serial"]);
    expect(callGives(t, t.calls[1])).toEqual(["Ends"]);
  });

  it("removing a per-item call takes its columns with it", async () => {
    const { removeCall } = await import("./builder");
    const t = warrantyTool({ blocks: [newBlock("table", 0, { id: "t", callId: "c", listId: "devices", fields: [{ path: "$.model", label: "Model", format: "text" }, { path: "$.expires", label: "Ends", format: "date", callId: "w" }] })] });
    const after = removeCall(t, "w");
    expect(after.blocks[0].fields.map((f) => f.label)).toEqual(["Model"]);
    expect(after.blocks[0].callId).toBe("c");
  });
});

describe("Save as HTML", () => {
  it("lists one closed entry per item under the table, and the cap note", async () => {
    const { toToolSnapshot } = await import("./snapshot");
    const many = Array.from({ length: 30 }, (_, i) => ({ serial: `S${i}`, model: `M${i}` }));
    const t: Tool = { ...warrantyTool(), blocks: [newBlock("table", 0, { id: "t", callId: "c", listId: "devices", fields: [{ path: "$.model", label: "Model", format: "text" }, { path: "$.expires", label: "Ends", format: "text", callId: "w" }] })] };
    const r = await run(t, server({ devices: many, status: (u) => (u.endsWith("S1") ? 500 : 200) }));
    const html = toToolSnapshot({ tool: t, results: Object.fromEntries(r.results.map((x) => [x.callId, x])), inputs: {}, findRequest: find });
    expect(html).toContain("<th>Ends</th>");
    expect(html).toContain("2027-01-01");
    expect(html).toContain("HTTP 500");
    expect(html).toContain("W: one request per device");
    expect(html.match(/<details><summary><b>M\d+<\/b>/g)).toHaveLength(25);
    expect(html).toContain("Ran for the first 25 of 30 devices");
  });
});
