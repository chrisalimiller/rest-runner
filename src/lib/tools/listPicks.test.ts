import { describe, expect, it, vi } from "vitest";
import type { SendFn } from "../batch";
import { newRequest } from "../defaults";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import type { PreparedRequest, RequestDef, SendOutcome } from "../types";
import { descendantListIds, rememberedIndex } from "./lists";
import { pendingRows, ToolSession, type LookupDeps } from "./session";
import { newBlock, newCall, newTool } from "./tools";
import type { ListRef, LookupRecord, PlaceholderMapping, Tool, ToolCall, ToolList } from "./types";
import { lookupAsText, picksText, tableView } from "./view";

/** Picking per list in Use mode: the session asks for each "ask" list, remembers picks, and changes one pick without rerunning the rest. */

const customer = {
  name: "Ada",
  services: [
    { id: "s1", name: "Mobile", features: [{ code: "roam" }, { code: "5g" }] },
    { id: "s2", name: "Broadband", features: [] },
    { id: "s3", name: "TV", features: [{ code: "sport" }] },
  ],
  devices: [
    { serial: "D1", model: "iPhone" },
    { serial: "D2", model: "Pixel" },
  ],
};
const requests: Record<string, string> = {
  customer: "https://api/customer/{{id}}",
  warranty: "https://api/warranty/{{serial}}",
  svc: "https://api/service/{{serviceId}}",
  feat: "https://api/feature/{{code}}",
  plain: "https://api/plain",
};
const find = (id: string): RequestDef | null => (requests[id] ? { ...newRequest(), id, name: id, url: requests[id] } : null);

function server(bodyOf: (url: string) => unknown = () => customer) {
  const urls: string[] = [];
  const send: SendFn = async (req: PreparedRequest) => {
    urls.push(req.url);
    await new Promise((r) => setTimeout(r, 1));
    const body = JSON.stringify(req.url.startsWith("https://api/customer") ? bodyOf(req.url) : {});
    return { request: req, sentAt: "2026-01-01T00:00:00.000Z", ok: true, response: { status: 200, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: 1 } } satisfies SendOutcome;
  };
  return { send, urls };
}
const deps = (send: SendFn, extra: Partial<LookupDeps> = {}): LookupDeps => ({ findRequest: find, envVars: {}, send, scripts: inlineScriptRunner, save: async () => true, ...extra });

const L = (id: string, extra: Partial<ToolList> = {}): ToolList => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), path: `$.${id}`, labelPath: id === "devices" ? "$.model" : "$.name", choose: { kind: "ask" }, ...extra });
const mk = (id: string, requestId: string, mappings: Record<string, PlaceholderMapping> = {}, extra: Partial<ToolCall> = {}): ToolCall => ({ ...newCall(requestId, id.toUpperCase()), id, mappings, ...extra });
const read = (callId: string, path: string, list?: ListRef): PlaceholderMapping => ({ call: { callId, path, ...(list ? { list } : {}) } });
const table = (listId: string) => newBlock("table", 0, { callId: "c", listId, title: listId, fields: [{ path: "$.name", label: "Name", format: "text" }] });

/** Customer with two asked lists (devices and services), a reader of each, and a table for each list. */
function twoLists(withTables = true): Tool {
  return {
    ...newTool("T"),
    inputs: [{ name: "id", label: "Id", kind: "text" }],
    calls: [
      mk("c", "customer", { id: { input: "id" } }, { lists: [L("devices"), L("services")] }),
      mk("w", "warranty", { serial: read("c", "$.serial", { listId: "devices" }) }),
      mk("s", "svc", { serviceId: read("c", "$.id", { listId: "services" }) }),
    ],
    blocks: withTables ? [table("devices"), table("services")] : [],
  };
}

describe("rememberedIndex", () => {
  const list = L("devices");
  const items = customer.devices;
  it("finds the item with the same label, preferring the same position", () => {
    expect(rememberedIndex(list, items, { index: 1, key: "Pixel" })).toBe(1);
    expect(rememberedIndex(list, items, { index: 0, key: "Pixel" })).toBe(1);
    expect(rememberedIndex(list, [{ model: "Pixel" }, { model: "Pixel" }], { index: 1, key: "Pixel" })).toBe(1);
  });
  it("is null with no pick, no label, or no item with that label", () => {
    expect(rememberedIndex(list, items, undefined)).toBeNull();
    expect(rememberedIndex(list, items, { index: 1 })).toBeNull();
    expect(rememberedIndex(list, items, { index: 1, key: "Nokia" })).toBeNull();
  });
});

describe("descendantListIds", () => {
  it("lists the lists inside, at any depth", () => {
    const call = mk("c", "customer", {}, { lists: [L("a"), L("b", { parentListId: "a" }), L("c", { parentListId: "b" }), L("d")] });
    expect(descendantListIds(call, "a")).toEqual(["b", "c"]);
    expect(descendantListIds(call, "d")).toEqual([]);
  });
});

describe("ToolSession: picking per list", () => {
  it("both lists of a call wait for a pick at once, each in its own table; a reader waits only for its list", async () => {
    const s = server();
    const session = new ToolSession("t");
    const tool = twoLists();
    const run = session.lookup(tool, deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending).toHaveLength(2));
    expect(pendingRows(session.getState(), "c", "devices")).toHaveLength(2);
    expect(pendingRows(session.getState(), "c", "services")).toHaveLength(3);
    // A pick-a-row lookup of the same call is a different thing.
    expect(pendingRows(session.getState(), "c")).toBeNull();
    session.choosePick("c", 1, "devices");
    await vi.waitFor(() => expect(s.urls).toContain("https://api/warranty/D2"));
    expect(session.getState().pending.map((p) => p.listId)).toEqual(["services"]);
    expect(s.urls.some((u) => u.includes("/service/"))).toBe(false);
    session.choosePick("c", 2, "services");
    const record = await run;
    expect(s.urls).toContain("https://api/service/s3");
    expect(record?.results.find((r) => r.callId === "c")?.picks).toEqual({ devices: { index: 1, key: "Pixel" }, services: { index: 2, key: "TV" } });
    expect(session.getState().pending).toEqual([]);
  });

  it("picking none skips the calls that read that list, and the other list's readers still run", async () => {
    const s = server();
    const session = new ToolSession("t");
    const run = session.lookup(twoLists(), deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending).toHaveLength(2));
    session.choosePick("c", null, "devices");
    session.choosePick("c", 0, "services");
    const record = await run;
    expect(record?.results.find((r) => r.callId === "w")).toMatchObject({ state: "skipped", message: "No row picked in Devices" });
    expect(record?.results.find((r) => r.callId === "s")?.state).toBe("done");
  });

  it("without a table block for a list, its first item is used and nothing is asked", async () => {
    const s = server();
    const session = new ToolSession("t");
    const record = await session.lookup(twoLists(false), deps(s.send), { id: "1" });
    expect(session.getState().pending).toEqual([]);
    expect(s.urls).toContain("https://api/warranty/D1");
    expect(record?.results.find((r) => r.callId === "c")?.picks).toEqual({ devices: { index: 0, key: "iPhone" }, services: { index: 0, key: "Mobile" } });
  });

  it("a list of one item is picked without asking", async () => {
    const s = server(() => ({ ...customer, devices: [{ serial: "D9", model: "Solo" }] }));
    const session = new ToolSession("t");
    const run = session.lookup(twoLists(), deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending.map((p) => p.listId)).toEqual(["services"]));
    expect(s.urls).toContain("https://api/warranty/D9");
    session.choosePick("c", 0, "services");
    await run;
  });

  it("looking up again with the same inputs picks a row with the same label again, without asking", async () => {
    const s = server();
    const session = new ToolSession("t");
    const first = session.lookup(twoLists(), deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending).toHaveLength(2));
    session.choosePick("c", 1, "devices");
    session.choosePick("c", 2, "services");
    await first;
    // The devices come back in another order: Pixel is now first, and is still the pick.
    const reordered = server(() => ({ ...customer, devices: [...customer.devices].reverse() }));
    const second = session.lookup(twoLists(), deps(reordered.send), { id: "1" });
    await vi.waitFor(() => expect(reordered.urls).toContain("https://api/warranty/D2"));
    expect(session.getState().pending).toEqual([]);
    const record = await second;
    expect(record?.results.find((r) => r.callId === "c")?.picks).toEqual({ devices: { index: 0, key: "Pixel" }, services: { index: 2, key: "TV" } });
  });

  it("asks again when the row is gone, or when the inputs changed", async () => {
    const s = server();
    const session = new ToolSession("t");
    const first = session.lookup(twoLists(), deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending).toHaveLength(2));
    session.choosePick("c", 1, "devices");
    session.choosePick("c", 2, "services");
    await first;
    // Same inputs, but the Pixel is gone: devices are asked again, services are not.
    const without = server(() => ({ ...customer, devices: [{ serial: "D1", model: "iPhone" }, { serial: "D3", model: "Nokia" }] }));
    const second = session.lookup(twoLists(), deps(without.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending.map((p) => p.listId)).toEqual(["devices"]));
    session.choosePick("c", 1, "devices");
    await second;
    // Other inputs: nothing is remembered.
    const third = session.lookup(twoLists(), deps(s.send), { id: "2" });
    await vi.waitFor(() => expect(session.getState().pending).toHaveLength(2));
    session.stop();
    await third;
  });

  it("a saved lookup replays its picks: the table marks the picked row and Copy all names each pick", async () => {
    const s = server();
    const session = new ToolSession("t");
    const tool = twoLists();
    const run = session.lookup(tool, deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending).toHaveLength(2));
    session.choosePick("c", 1, "devices");
    session.choosePick("c", 0, "services");
    const record = (await run) as LookupRecord;
    const viewer = new ToolSession("t");
    viewer.show(JSON.parse(JSON.stringify(record)));
    const c = viewer.getState().results.c;
    const call = tool.calls[0];
    expect(tableView(tool.blocks[0], call, c).pickedIndex).toBe(1);
    expect(tableView(tool.blocks[1], call, c).pickedIndex).toBe(0);
    expect(picksText(call, c)).toBe("Devices: Pixel; Services: Mobile");
    const text = lookupAsText(tool, viewer.getState().results, find);
    expect(text).toContain("Picked Devices: Pixel; Services: Mobile");
  });
});

describe("ToolSession.changeListPick", () => {
  async function picked(tool: Tool, s: ReturnType<typeof server>) {
    const session = new ToolSession("t");
    const run = session.lookup(tool, deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending.length).toBeGreaterThan(0));
    for (const p of [...session.getState().pending]) session.choosePick(p.callId, 0, p.listId);
    await run;
    return session;
  }

  it("keeps the new item and runs only the calls that read that list", async () => {
    const s = server();
    const tool = twoLists();
    const session = await picked(tool, s);
    const before = session.getState().results;
    s.urls.length = 0;
    await session.changeListPick(tool, "c", "devices", 1, deps(s.send));
    const after = session.getState();
    expect(after.results.c.picks).toEqual({ devices: { index: 1, key: "Pixel" }, services: { index: 0, key: "Mobile" } });
    expect(s.urls).toEqual(["https://api/warranty/D2"]);
    expect(after.results.w).not.toBe(before.w);
    expect(after.results.s).toBe(before.s);
    expect(after.sending).toEqual([]);
  });

  it("none clears the pick; the readers are skipped with the reason", async () => {
    const s = server();
    const tool = twoLists();
    const session = await picked(tool, s);
    await session.changeListPick(tool, "c", "devices", null, deps(s.send));
    expect(session.getState().results.c.picks).toEqual({ services: { index: 0, key: "Mobile" } });
    expect(session.getState().results.w).toMatchObject({ state: "skipped", message: "No row picked in Devices" });
  });

  it("ignores an index outside the list, a running lookup and an unknown list", async () => {
    const s = server();
    const tool = twoLists();
    const session = await picked(tool, s);
    const before = session.getState().results;
    await session.changeListPick(tool, "c", "devices", 9, deps(s.send));
    await session.changeListPick(tool, "c", "nope", 0, deps(s.send));
    expect(session.getState().results).toEqual(before);
  });

  it("a different parent drops the picks inside it, and what reads them runs again", async () => {
    const lists = [L("services"), L("features", { path: "$.features", parentListId: "services", labelPath: "$.code" })];
    const tool: Tool = {
      ...newTool("T"),
      inputs: [{ name: "id", label: "Id", kind: "text" }],
      calls: [mk("c", "customer", { id: { input: "id" } }, { lists }), mk("f", "feat", { code: read("c", "$.code", { listId: "features" }) }), mk("n", "svc", { serviceId: read("c", "$.id", { listId: "services" }) })],
      blocks: [table("services")],
    };
    const s = server();
    const session = new ToolSession("t");
    const run = session.lookup(tool, deps(s.send), { id: "1" });
    await vi.waitFor(() => expect(session.getState().pending.map((p) => p.listId)).toEqual(["services"]));
    session.choosePick("c", 0, "services");
    // Features have no table, so their first item is used.
    await run;
    expect(session.getState().results.c.picks).toEqual({ services: { index: 0, key: "Mobile" }, features: { index: 0, key: "roam" } });
    s.urls.length = 0;
    await session.changeListPick(tool, "c", "services", 2, deps(s.send));
    const after = session.getState().results;
    expect(after.c.picks).toEqual({ services: { index: 2, key: "TV" } });
    expect(s.urls.sort()).toEqual(["https://api/service/s3"]);
    expect(after.f).toMatchObject({ state: "skipped", message: "No row picked in Features" });
  });
});
