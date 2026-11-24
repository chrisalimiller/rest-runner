import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import { newRequest } from "../defaults";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import type { PreparedRequest, RequestDef, SendOutcome } from "../types";
import { canRetryAlone, dependentCalls, runLookup, runWriteCall, type LookupContext, type PickItemRequest } from "./engine";
import { convertPickRow } from "./lists";
import { cleanTools, newBlock, newCall, newTool } from "./tools";
import { importToolsFile, toToolsFile } from "./toolsFile";
import type { CallResult, ListRef, PlaceholderMapping, Tool, ToolCall, ToolList } from "./types";
import { fieldRows, jsonText, tableView } from "./view";

const customer = {
  name: "Ada",
  services: [
    { id: "s1", name: "Mobile", status: "active", features: [{ code: "roam" }, { code: "5g" }] },
    { id: "s2", name: "Broadband", status: "suspended", features: [] },
    { id: "s3", name: "TV", status: "active", features: [{ code: "sport" }] },
  ],
  devices: [
    { serial: "D1", model: "iPhone", serviceId: "s1" },
    { serial: "D2", model: "Pixel", serviceId: "s2" },
  ],
};

const requests: Record<string, string> = {
  customer: "https://api/customer",
  empty: "https://api/empty",
  one: "https://api/one",
  warranty: "https://api/warranty/{{serial}}",
  svc: "https://api/service/{{serviceId}}",
  feat: "https://api/feature/{{code}}",
  slow: "https://api/slow",
  wanted: "https://api/wanted",
  multi: "https://api/multi?ids={{ids}}&n={{n}}",
};
const bodies: Record<string, unknown> = {
  "https://api/customer": customer,
  "https://api/empty": { services: [], devices: [] },
  "https://api/one": { services: [{ id: "only", name: "Solo", status: "active", features: [] }], devices: [] },
  "https://api/slow": { want: "suspended" },
  "https://api/wanted": { want: "suspended" },
};

const find = (id: string): RequestDef | null => (requests[id] ? { ...newRequest(), id, name: id, url: requests[id] } : null);

function server(delays: Record<string, number> = {}) {
  const urls: string[] = [];
  const send: SendFn = async (req: PreparedRequest, signal) => {
    urls.push(req.url);
    const delay = delays[req.url] ?? 1;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => (clearTimeout(t), resolve()));
    });
    const body = JSON.stringify(bodies[req.url] ?? {});
    return { request: req, sentAt: "2026-01-01T00:00:00.000Z", ok: true, response: { status: 200, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: delay } } satisfies SendOutcome;
  };
  return { send, urls };
}

const L = (id: string, extra: Partial<ToolList> = {}): ToolList => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), path: `$.${id}`, labelPath: id === "devices" ? "$.model" : "$.name", choose: { kind: "none" }, ...extra });
const mk = (id: string, requestId: string, mappings: Record<string, PlaceholderMapping> = {}, extra: Partial<ToolCall> = {}): ToolCall => ({ ...newCall(requestId, id.toUpperCase()), id, mappings, ...extra });
const read = (callId: string, path: string, list?: ListRef): PlaceholderMapping => ({ call: { callId, path, ...(list ? { list } : {}) } });
const toolOf = (calls: ToolCall[], extra: Partial<Tool> = {}): Tool => ({ ...newTool("T"), calls, ...extra });
const run = (tool: Tool, s: { send: SendFn }, extra: Partial<LookupContext> = {}, inputs: Record<string, string> = {}) =>
  runLookup(tool, inputs, { findRequest: find, envVars: {}, send: s.send, scripts: inlineScriptRunner, ...extra });
const result = (r: { results: CallResult[] }, id: string) => r.results.find((x) => x.callId === id)!;
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe("lists: choosing without asking", () => {
  it("reads the last, the first and a numbered item", async () => {
    const tool = toolOf([
      mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "index", index: -1 } })] }),
      mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) }),
    ]);
    const s = server();
    await run(tool, s);
    expect(s.urls).toEqual(["https://api/customer", "https://api/warranty/D2"]);
  });

  it("a reference's own rule beats the list's rule", async () => {
    const tool = toolOf([
      mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "index", index: -1 } })] }),
      mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices", item: { kind: "index", index: 0 } }) }),
    ]);
    const s = server();
    await run(tool, s);
    expect(s.urls[1]).toBe("https://api/warranty/D1");
  });

  it("first where, with the value from an input", async () => {
    const rule = { kind: "where", field: "$.status", op: "eq", value: { input: "status" } } as const;
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("services", { choose: rule })] }), mk("s", "svc", { serviceId: read("c", "$.id", { listId: "services" }) })], { inputs: [{ name: "status", label: "", kind: "text" }] });
    const s = server();
    await run(tool, s, {}, { status: "suspended" });
    expect(s.urls[1]).toBe("https://api/service/s2");
  });

  it("a where whose value comes from another call waits for that call", async () => {
    const rule = { kind: "where", field: "$.status", op: "eq", value: read("w", "$.want") } as const;
    const tool = toolOf([
      mk("c", "customer", {}, { lists: [L("services", { choose: rule })] }),
      mk("w", "slow"),
      mk("s", "svc", { serviceId: read("c", "$.id", { listId: "services" }) }),
    ]);
    const s = server({ "https://api/slow": 30 });
    const events: string[] = [];
    const out = await run(tool, s, { onCall: (r) => events.push(r.callId) });
    expect(events.indexOf("w")).toBeLessThan(events.indexOf("s"));
    expect(s.urls).toContain("https://api/service/s2");
    expect(result(out, "s").state).toBe("done");
  });

  it("all joined and a count", async () => {
    const tool = toolOf([
      mk("c", "customer", {}, { lists: [L("services")] }),
      mk("m", "multi", { ids: read("c", "$.id", { listId: "services", item: { kind: "all", join: ",", where: { field: "$.status", op: "eq", value: { fixed: "active" } } } }), n: read("c", "", { listId: "services", item: { kind: "count" } }) }),
    ]);
    const s = server();
    await run(tool, s);
    expect(s.urls[1]).toBe("https://api/multi?ids=s1,s3&n=3");
  });

  it("an inner list reads from the parent's chosen item", async () => {
    const lists = [L("services", { choose: { kind: "index", index: 2 } }), L("features", { path: "$.features", parentListId: "services", labelPath: "$.code", choose: { kind: "index", index: 0 } })];
    const tool = toolOf([mk("c", "customer", {}, { lists }), mk("f", "feat", { code: read("c", "$.code", { listId: "features" }) })]);
    const s = server();
    await run(tool, s);
    expect(s.urls[1]).toBe("https://api/feature/sport");
  });

  it("a field with no list reads the whole response, as before", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), mk("s", "svc", { serviceId: read("c", "$.services[1].id") })]);
    const s = server();
    await run(tool, s);
    expect(s.urls[1]).toBe("https://api/service/s2");
  });
});

describe("lists: skipping with a reason", () => {
  it("an empty list", async () => {
    const tool = toolOf([mk("c", "empty", {}, { lists: [L("devices", { choose: { kind: "index", index: 0 } })] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) })]);
    const s = server();
    const out = await run(tool, s);
    expect(result(out, "w")).toMatchObject({ state: "skipped", reason: "needs-value", message: "C has no devices" });
    expect(s.urls).toEqual(["https://api/empty"]);
  });

  it("first where matches nothing", async () => {
    const rule = { kind: "where", field: "$.status", op: "eq", value: { fixed: "closed" } } as const;
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("services", { choose: rule })] }), mk("s", "svc", { serviceId: read("c", "$.id", { listId: "services" }) })]);
    expect(result(await run(tool, server()), "s").message).toBe("No service where status = closed in C");
  });

  it("the path is not a list at run time", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("name", { choose: { kind: "index", index: 0 } })] }), mk("s", "svc", { serviceId: read("c", "$.id", { listId: "name" }) })]);
    expect(result(await run(tool, server()), "s").message).toBe("Name is not a list in this response");
  });

  it("a list that was removed", async () => {
    const tool = toolOf([mk("c", "customer"), mk("s", "svc", { serviceId: read("c", "$.id", { listId: "gone" }) })]);
    expect(result(await run(tool, server()), "s")).toMatchObject({ state: "skipped" });
  });

  it("when the source call fails, the readers are skipped and the run still ends", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) })]);
    const failing: SendFn = async (req) => ({ request: req, sentAt: "x", ok: false, error: "refused", durationMs: 1 });
    const out = await run(tool, { send: failing });
    expect(out.results.map((r) => r.state)).toEqual(["network-error", "skipped"]);
  });
});

describe("lists: asking", () => {
  it("a call with lists finishes at once; only readers of the pick wait for it", async () => {
    const tool = toolOf([
      mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }),
      mk("name", "svc", { serviceId: read("c", "$.name") }),
      mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) }),
    ]);
    const s = server();
    let release: (n: number | null) => void = () => {};
    const asked: PickItemRequest[] = [];
    const p = run(tool, s, { pickItem: (req) => (asked.push(req), new Promise<number | null>((r) => (release = r))) });
    await tick();
    expect(asked).toHaveLength(1);
    expect(asked[0].list.id).toBe("devices");
    expect(asked[0].items).toHaveLength(2);
    expect(s.urls).toEqual(["https://api/customer", "https://api/service/Ada"]);
    release(1);
    const out = await p;
    expect(s.urls[2]).toBe("https://api/warranty/D2");
    expect(result(out, "c").picks).toEqual({ devices: { index: 1, key: "Pixel" } });
    expect(result(out, "w").state).toBe("done");
  });

  it("two lists of one call are asked at once, and a reader waits only for the list it reads", async () => {
    const tool = toolOf([
      mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } }), L("services", { choose: { kind: "ask" } })] }),
      mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) }),
      mk("s", "svc", { serviceId: read("c", "$.id", { listId: "services" }) }),
    ]);
    const s = server();
    const release: Record<string, (n: number | null) => void> = {};
    const p = run(tool, s, { pickItem: (req) => new Promise<number | null>((r) => (release[req.list.id] = r)) });
    await tick();
    expect(Object.keys(release).sort()).toEqual(["devices", "services"]);
    release.devices(0);
    await tick();
    expect(s.urls).toContain("https://api/warranty/D1");
    expect(s.urls.some((u) => u.includes("/service/"))).toBe(false);
    release.services(2);
    const out = await p;
    expect(s.urls).toContain("https://api/service/s3");
    expect(out.results.every((r) => r.state === "done")).toBe(true);
  });

  it("a list inside a list is asked after its parent is picked", async () => {
    const lists = [L("services", { choose: { kind: "ask" } }), L("features", { path: "$.features", parentListId: "services", labelPath: "$.code", choose: { kind: "ask" } })];
    const tool = toolOf([mk("c", "customer", {}, { lists }), mk("f", "feat", { code: read("c", "$.code", { listId: "features" }) })]);
    const s = server();
    const order: string[] = [];
    const out = await run(tool, s, {
      pickItem: async ({ list, items }) => {
        order.push(`${list.id}:${items.length}`);
        return list.id === "services" ? 0 : 1;
      },
    });
    expect(order).toEqual(["services:3", "features:2"]);
    expect(s.urls[1]).toBe("https://api/feature/5g");
    expect(result(out, "c").picks).toEqual({ services: { index: 0, key: "Mobile" }, features: { index: 1, key: "5g" } });
  });

  it("a list of one item is picked without asking, unless the list says to ask", async () => {
    const tool = toolOf([mk("c", "one", {}, { lists: [L("services", { choose: { kind: "ask" } })] }), mk("s", "svc", { serviceId: read("c", "$.id", { listId: "services" }) })]);
    let asks = 0;
    const s = server();
    await run(tool, s, { pickItem: async () => (asks++, 0) });
    expect(asks).toBe(0);
    expect(s.urls[1]).toBe("https://api/service/only");
    const strict = toolOf([mk("c", "one", {}, { lists: [L("services", { choose: { kind: "ask" }, autoPickSingle: false })] }), tool.calls[1]]);
    await run(strict, server(), { pickItem: async () => (asks++, 0) });
    expect(asks).toBe(1);
  });

  it("with no chooser the first item is used, and an empty list is not asked", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) })]);
    const s = server();
    await run(tool, s);
    expect(s.urls[1]).toBe("https://api/warranty/D1");
    let asks = 0;
    const empty = toolOf([mk("c", "empty", {}, { lists: [L("devices", { choose: { kind: "ask" } })] })]);
    await run(empty, server(), { pickItem: async () => (asks++, 0) });
    expect(asks).toBe(0);
  });

  it("choosing none skips the readers", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) })]);
    const out = await run(tool, server(), { pickItem: async () => null });
    expect(result(out, "w")).toMatchObject({ state: "skipped", message: "No row picked in Devices" });
    expect(result(out, "c").picks).toBeUndefined();
  });

  it("a bad index from the chooser counts as none", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] })]);
    const out = await run(tool, server(), { pickItem: async () => 9 });
    expect(result(out, "c").picks).toBeUndefined();
  });

  it("a value read with the ask rule asks about a list whose own rule is something else", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices")] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices", item: { kind: "ask" } }) })]);
    const asked: string[] = [];
    const s = server();
    await run(tool, s, { pickItem: async ({ list }) => (asked.push(list.id), 1) });
    expect(asked).toEqual(["devices"]);
    expect(s.urls[1]).toBe("https://api/warranty/D2");
  });

  it("Stop while waiting for a pick ends the lookup", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) })]);
    const ac = new AbortController();
    const p = run(tool, server(), { signal: ac.signal, pickItem: () => new Promise(() => {}) });
    await tick();
    ac.abort();
    const out = await p;
    expect(out.stopped).toBe(true);
    expect(result(out, "w").state).toBe("stopped");
  });

  it("a chooser that throws counts as none", async () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) })]);
    const out = await run(tool, server(), { pickItem: () => Promise.reject(new Error("x")) });
    expect(result(out, "w").state).toBe("skipped");
  });

  it("a call with lists is retried with the whole lookup, and its readers depend on it", () => {
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) })]);
    expect(canRetryAlone(tool, "c", find)).toBe(false);
    expect(dependentCalls(tool, "c", find).map((c) => c.id)).toEqual(["w"]);
  });

  it("a write call reads the pick of the last lookup", async () => {
    const write = mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) }, { write: true });
    const tool = toolOf([mk("c", "customer", {}, { lists: [L("devices", { choose: { kind: "ask" } })] }), write]);
    const s = server();
    const out = await run(tool, s, { pickItem: async () => 1 });
    expect(s.urls).toEqual(["https://api/customer"]);
    const sent = await runWriteCall(tool, "w", {}, { findRequest: find, envVars: {}, send: s.send, scripts: inlineScriptRunner, prior: { c: result(out, "c") } });
    expect(sent.state).toBe("done");
    expect(s.urls[1]).toBe("https://api/warranty/D2");
  });
});

describe("lists: views", () => {
  const tool = toolOf([mk("c", "customer", {}, { lists: [L("services", { choose: { kind: "ask" } }), L("devices")] })], {
    blocks: [
      newBlock("table", 0, { id: "t1", callId: "c", listId: "devices", fields: [{ path: "$.model", label: "Model", format: "text" }] }),
      newBlock("table", 0, { id: "t2", callId: "c", listId: "services", fields: [{ path: "$.name", label: "Name", format: "text" }] }),
      newBlock("table", 0, { id: "t3", callId: "c", fields: [{ path: "$.name", label: "Name", format: "text" }] }),
      newBlock("fields", 0, { id: "f1", callId: "c", fields: [{ path: "$.name", label: "Service", format: "text", list: { listId: "services" } }, { path: "$.name", label: "Customer", format: "text" }] }),
      newBlock("json", 0, { id: "j1", callId: "c", fields: [{ path: "$", label: "", format: "text", list: { listId: "services" } }] }),
    ],
  });
  it("a table shows its own list, marks the picked item, and a table with no list keeps today's choice", async () => {
    const out = await run(tool, server(), { pickItem: async () => 2 });
    const r = result(out, "c");
    const [t1, t2, t3, f1, j1] = tool.blocks;
    expect(tableView(t1, tool.calls[0], r).rows).toEqual([["iPhone"], ["Pixel"]]);
    expect(tableView(t1, tool.calls[0], r)).toMatchObject({ pickedIndex: null, note: null });
    expect(tableView(t2, tool.calls[0], r)).toMatchObject({ pickedIndex: 2, rows: [["Mobile"], ["Broadband"], ["TV"]] });
    // No list named: the first list in the response, as before.
    expect(tableView(t3, tool.calls[0], r).rows).toEqual([["Mobile"], ["Broadband"], ["TV"]]);
    expect("note" in tableView(t3, tool.calls[0], r)).toBe(false);
    expect(fieldRows(f1, tool.calls[0], r)).toEqual([{ label: "Service", value: "TV" }, { label: "Customer", value: "Ada" }]);
    expect(JSON.parse(jsonText(j1, tool.calls[0], r)).id).toBe("s3");
  });
  it("a table on an empty list says so", async () => {
    const t = toolOf([mk("c", "empty", {}, { lists: [L("devices")] })], { blocks: [newBlock("table", 0, { callId: "c", listId: "devices", fields: [] })] });
    const out = await run(t, server());
    expect(tableView(t.blocks[0], t.calls[0], result(out, "c"))).toMatchObject({ rows: [], note: "No devices" });
  });
});

describe("tools with lists: saving and files", () => {
  const withLists = toolOf(
    [
      mk("c", "customer", {}, { lists: [L("services", { choose: { kind: "where", field: "$.status", op: "ne", value: { input: "x" } }, autoPickSingle: false }), L("features", { path: "$.features", parentListId: "services", labelPath: "$.code" })] }),
      mk("m", "multi", { ids: read("c", "$.id", { listId: "services", item: { kind: "all", join: ";", where: { field: "$.status", op: "eq", value: read("c", "$.name", { listId: "services", item: { kind: "index", index: 0 } }) } } }), n: read("c", "", { listId: "services", item: { kind: "count" } }) }),
    ],
    { blocks: [newBlock("table", 0, { id: "t", callId: "c", listId: "services", fields: [{ path: "$.name", label: "N", format: "text", list: { listId: "services", item: { kind: "ask" } } }] })] },
  );

  it("cleanTools keeps every new field", () => {
    const json = JSON.parse(JSON.stringify([withLists]));
    expect(cleanTools(json)).toEqual(json);
  });

  it("cleanTools drops what cannot be used: bad rules, duplicate lists, lists inside lists that are not there, and lists on a pick-a-row call", () => {
    const messy = JSON.parse(JSON.stringify([withLists]));
    const call = messy[0].calls[0];
    call.lists.push({ id: "services", name: "dup", path: "x", labelPath: "", choose: { kind: "ask" } });
    call.lists.push({ id: "orphan", name: "Orphan", path: "x", parentListId: "nowhere", labelPath: "", choose: { kind: "ask" } });
    call.lists.push({ id: "loopA", name: "A", path: "x", parentListId: "loopB", labelPath: "", choose: { kind: "ask" } });
    call.lists.push({ id: "loopB", name: "B", path: "x", parentListId: "loopA", labelPath: "", choose: { kind: "ask" } });
    call.lists.push({ id: "weird", name: "W", path: "x", labelPath: "", choose: { kind: "banana" } });
    call.lists.push({ id: "idx", name: "I", path: "x", labelPath: "", choose: { kind: "index", index: 1.5 } });
    const cleaned = cleanTools(messy)[0].calls[0];
    expect(cleaned.lists?.map((l) => l.id)).toEqual(["services", "features", "weird", "idx"]);
    expect(cleaned.lists?.find((l) => l.id === "weird")?.choose).toEqual({ kind: "none" });
    expect(cleaned.lists?.find((l) => l.id === "idx")?.choose).toEqual({ kind: "none" });
    const both = JSON.parse(JSON.stringify([withLists]));
    both[0].calls[0].pickRow = { listPath: "$", labelPath: "" };
    const kept = cleanTools(both)[0].calls[0];
    expect(kept.pickRow).toBeDefined();
    expect(kept.lists).toBeUndefined();
  });

  it("a tool with lists exports as version 2 and imports back unchanged; one without stays version 1", () => {
    const text = toToolsFile([withLists], []);
    expect(JSON.parse(text).version).toBe(2);
    expect(importToolsFile(text, { tools: [], collections: [] }).tools).toEqual([withLists]);
    expect(JSON.parse(toToolsFile([toolOf([mk("c", "customer")])], [])).version).toBe(1);
  });

  it("refuses a file from a newer version, and still reads versions 1 and 2", () => {
    const file = (version: number) => JSON.stringify({ app: "rest-runner", kind: "tools", version, tools: [], requests: [] });
    expect(() => importToolsFile(file(3), { tools: [], collections: [] })).toThrow("This file needs a newer REST Runner");
    expect(() => importToolsFile(file(1), { tools: [], collections: [] })).not.toThrow();
    expect(() => importToolsFile(file(2), { tools: [], collections: [] })).not.toThrow();
  });
});

describe("convertPickRow", () => {
  const legacy = (): Tool => ({
    ...newTool("Pick"),
    calls: [
      { ...mk("d", "customer"), pickRow: { listPath: "$.devices", labelPath: "$.model" } },
      mk("w", "warranty", { serial: read("d", "$.serial") }),
    ],
    blocks: [
      newBlock("table", 0, { id: "t", callId: "d", fields: [{ path: "$.model", label: "Model", format: "text" }] }),
      newBlock("fields", 0, { id: "f", callId: "d", fields: [{ path: "$.serial", label: "Serial", format: "text" }] }),
      newBlock("json", 1, { id: "j", callId: "d", fields: [] }),
      newBlock("status", 1, { id: "s", callId: "w", fields: [{ path: "$.x", label: "", format: "text" }] }),
    ],
  });

  it("gives the same URLs and the same values as the pick-a-row call, for every row", async () => {
    for (const index of [0, 1]) {
      const old = legacy();
      const converted = convertPickRow(old, "d");
      const s1 = server();
      const s2 = server();
      const a = await run(old, s1, { pickRow: async () => index });
      const b = await run(converted, s2, { pickItem: async () => index });
      expect(s2.urls).toEqual(s1.urls);
      const [oc] = old.calls;
      const [cc] = converted.calls;
      for (const [i, block] of old.blocks.slice(0, 3).entries()) {
        const ob = block;
        const cb = converted.blocks[i];
        if (ob.type === "table") {
          expect(tableView(cb, cc, result(b, "d")).rows).toEqual(tableView(ob, oc, result(a, "d")).rows);
          expect(tableView(cb, cc, result(b, "d")).pickedIndex).toBe(tableView(ob, oc, result(a, "d")).pickedIndex);
        } else if (ob.type === "fields") {
          expect(fieldRows(cb, cc, result(b, "d"))).toEqual(fieldRows(ob, oc, result(a, "d")));
        } else {
          expect(jsonText(cb, cc, result(b, "d"))).toBe(jsonText(ob, oc, result(a, "d")));
        }
      }
    }
  });

  it("makes one list set to ask, removes pickRow, and rewrites only what reads from that call", () => {
    const converted = convertPickRow(legacy(), "d");
    const [d, w] = converted.calls;
    expect(d.pickRow).toBeUndefined();
    expect(d.lists).toHaveLength(1);
    expect(d.lists?.[0]).toMatchObject({ name: "Devices", path: "$.devices", labelPath: "$.model", choose: { kind: "ask" } });
    const listId = d.lists![0].id;
    expect(w.mappings.serial).toEqual({ call: { callId: "d", path: "$.serial", list: { listId } } });
    expect(converted.blocks[0].listId).toBe(listId);
    expect(converted.blocks[3].fields[0].list).toBeUndefined();
    // The conversion survives saving and loading, and dependents still wait for the pick.
    expect(cleanTools(JSON.parse(JSON.stringify([converted])))).toEqual([converted]);
    expect(dependentCalls(converted, "d", find).map((c) => c.id)).toEqual(["w"]);
  });

  it("leaves a call that is not a pick-a-row call alone, and an old lookup still shows its row", async () => {
    const t = legacy();
    expect(convertPickRow(t, "w")).toBe(t);
    expect(convertPickRow(t, "nope")).toBe(t);
    const converted = convertPickRow(t, "d");
    const old = await run(t, server(), { pickRow: async () => 1 });
    // The saved lookup has `picked`, not `picks`.
    expect(fieldRows(converted.blocks[1], converted.calls[0], result(old, "d"))).toEqual([{ label: "Serial", value: "D2" }]);
  });
});
