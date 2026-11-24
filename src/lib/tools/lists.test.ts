import { describe, expect, it } from "vitest";
import {
  callNeeds,
  chooseItem,
  itemLabel,
  listItems,
  listNote,
  listsToAsk,
  matchesWhere,
  readList,
  readListValue,
  toolUsesLists,
  type ListSource,
  type ValueResolver,
} from "./lists";
import { newBlock, newCall, newTool } from "./tools";
import type { ToolCall, ToolList } from "./types";

const body = {
  name: "Ada",
  services: [
    { id: "s1", name: "Mobile", status: "active", features: [{ code: "roam" }, { code: "5g" }] },
    { id: "s2", name: "Broadband", status: "suspended", features: [] },
    { id: "s3", name: "TV", status: "active", features: [{ code: "sport" }] },
  ],
  devices: [{ serial: "D1", model: "iPhone" }],
  notAList: { a: 1 },
};

const list = (id: string, extra: Partial<ToolList> = {}): ToolList => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), path: `$.${id}`, labelPath: "$.name", choose: { kind: "none" }, ...extra });

function source(lists: ToolList[], extra: Partial<ListSource> = {}): ListSource {
  const call: ToolCall = { ...newCall("customer", "Customer"), id: "c1", lists };
  return { call, json: body, resolve: () => null, ...extra };
}

const fixed: ValueResolver = (m) => m.fixed ?? null;

describe("readList", () => {
  it("reads a list from the whole response", () => {
    expect(listItems(source([list("services")]), "services")).toHaveLength(3);
  });

  it("treats $ and an empty path as the response itself", () => {
    const s = source([list("all", { path: "$" })], { json: [1, 2] });
    expect(listItems(s, "all")).toEqual([1, 2]);
    expect(listItems(source([list("all", { path: "" })], { json: [1] }), "all")).toEqual([1]);
  });

  it("says when the path is not a list, and treats it as empty", () => {
    const s = source([list("notAList")]);
    const r = readList(s, "notAList");
    expect(r).toMatchObject({ ok: false, kind: "not-a-list", message: "NotAList is not a list in this response" });
    expect(listItems(s, "notAList")).toEqual([]);
    expect(listNote(s, "notAList")).toBe("NotAList is not a list in this response");
  });

  it("reads an inner list from the parent's chosen item", () => {
    const lists = [list("services", { choose: { kind: "index", index: 2 } }), list("features", { path: "$.features", parentListId: "services", labelPath: "$.code" })];
    expect(listItems(source(lists), "features")).toEqual([{ code: "sport" }]);
  });

  it("an inner list is empty, with the parent's reason, until the parent has a chosen item", () => {
    const lists = [list("services", { choose: { kind: "ask" } }), list("features", { path: "$.features", parentListId: "services" })];
    expect(readList(source(lists), "features")).toMatchObject({ ok: false, kind: "not-picked", message: "No row picked in Services" });
    expect(listItems(source(lists, { picks: { services: { index: 0 } } }), "features")).toHaveLength(2);
    expect(readList(source([list("services"), list("features", { path: "$.features", parentListId: "services" })]), "features")).toMatchObject({ ok: false, kind: "no-item" });
  });

  it("does not loop on lists that sit inside each other", () => {
    const lists = [list("a", { parentListId: "b" }), list("b", { parentListId: "a" })];
    expect(readList(source(lists), "a").ok).toBe(false);
  });

  it("names a list that was removed", () => {
    expect(readList(source([]), "gone")).toMatchObject({ ok: false, kind: "unknown-list" });
  });

  it("says 'No devices' for an empty list", () => {
    const s = source([list("devices")], { json: { devices: [] } });
    expect(listNote(s, "devices")).toBe("No devices");
    expect(listNote(source([list("devices")]), "devices")).toBeNull();
  });
});

describe("chooseItem", () => {
  const lists = [list("services")];
  it("none: no item", () => {
    expect(chooseItem(source(lists), "services")).toMatchObject({ ok: false, kind: "no-item" });
  });
  it("ask: the pick, else not picked", () => {
    const l = [list("services", { choose: { kind: "ask" } })];
    expect(chooseItem(source(l, { picks: { services: { index: 1 } } }), "services")).toMatchObject({ ok: true, index: 1, item: { id: "s2" } });
    expect(chooseItem(source(l), "services")).toMatchObject({ ok: false, kind: "not-picked" });
    expect(chooseItem(source(l, { picks: { services: { index: 9 } } }), "services")).toMatchObject({ ok: false, kind: "not-picked" });
  });
  it("index: first, last, from the end, row number, and out of range", () => {
    const at = (index: number) => chooseItem(source(lists), "services", { kind: "index", index });
    expect(at(0)).toMatchObject({ ok: true, item: { id: "s1" } });
    expect(at(-1)).toMatchObject({ ok: true, item: { id: "s3" } });
    expect(at(-2)).toMatchObject({ ok: true, item: { id: "s2" } });
    expect(at(2)).toMatchObject({ ok: true, item: { id: "s3" } });
    expect(at(3)).toMatchObject({ ok: false, kind: "out-of-range" });
    expect(at(-4)).toMatchObject({ ok: false, kind: "out-of-range" });
  });
  it("where: the first match, eq and ne", () => {
    const s = source(lists, { resolve: fixed });
    expect(chooseItem(s, "services", { kind: "where", field: "$.status", op: "eq", value: { fixed: "active" } })).toMatchObject({ ok: true, index: 0 });
    expect(chooseItem(s, "services", { kind: "where", field: "$.status", op: "ne", value: { fixed: "active" } })).toMatchObject({ ok: true, index: 1 });
  });
  it("where: says what it looked for when nothing matches", () => {
    const s = source(lists, { resolve: fixed });
    expect(chooseItem(s, "services", { kind: "where", field: "$.status", op: "eq", value: { fixed: "gone" } })).toMatchObject({ ok: false, kind: "no-match", message: "No service where status = gone in Customer" });
  });
  it("where: waits for a value that is not known yet", () => {
    expect(chooseItem(source(lists), "services", { kind: "where", field: "$.status", op: "eq", value: { input: "x" } })).toMatchObject({ ok: false, kind: "no-value" });
  });
  it("an empty list says so for every rule", () => {
    const s = source([list("devices")], { json: { devices: [] } });
    for (const rule of [{ kind: "ask" }, { kind: "index", index: 0 }, { kind: "where", field: "$.a", op: "eq", value: { fixed: "1" } }] as const) {
      expect(chooseItem(s, "devices", rule)).toMatchObject({ ok: false, kind: "empty", message: "Customer has no devices" });
    }
  });
  it("matchesWhere compares text, so 5 equals \"5\"; ne also matches a missing field", () => {
    expect(matchesWhere({ n: 5 }, "$.n", "eq", "5")).toBe(true);
    expect(matchesWhere({}, "$.n", "ne", "5")).toBe(true);
    expect(matchesWhere({}, "$.n", "eq", "5")).toBe(false);
  });
});

describe("readListValue", () => {
  const lists = [list("services", { choose: { kind: "index", index: 0 } })];
  const s = source(lists, { resolve: fixed });
  it("reads from the list's own rule", () => {
    expect(readListValue(s, "$.id", { listId: "services" })).toEqual({ ok: true, value: "s1" });
  });
  it("a reference's rule overrides the list's", () => {
    expect(readListValue(s, "$.id", { listId: "services", item: { kind: "index", index: -1 } })).toEqual({ ok: true, value: "s3" });
  });
  it("all joined, with and without where", () => {
    expect(readListValue(s, "$.id", { listId: "services", item: { kind: "all", join: "," } })).toEqual({ ok: true, value: "s1,s2,s3" });
    expect(readListValue(s, "$.id", { listId: "services", item: { kind: "all", join: " | ", where: { field: "$.status", op: "eq", value: { fixed: "active" } } } })).toEqual({ ok: true, value: "s1 | s3" });
  });
  it("count, with and without where", () => {
    expect(readListValue(s, "", { listId: "services", item: { kind: "count" } })).toEqual({ ok: true, value: 3 });
    expect(readListValue(s, "", { listId: "services", item: { kind: "count", where: { field: "$.status", op: "eq", value: { fixed: "suspended" } } } })).toEqual({ ok: true, value: 1 });
    expect(readListValue(s, "", { listId: "services", item: { kind: "count", where: { field: "$.status", op: "eq", value: { fixed: "none" } } } })).toEqual({ ok: true, value: 0 });
  });
  it("all of an empty list says so; a missing field in the item is an undefined value", () => {
    const empty = source([list("devices")], { json: { devices: [] } });
    expect(readListValue(empty, "$.serial", { listId: "devices", item: { kind: "all", join: "," } })).toMatchObject({ ok: false, kind: "empty" });
    expect(readListValue(s, "$.nothing", { listId: "services" })).toEqual({ ok: true, value: undefined });
  });
  it("reads the whole item with an empty path", () => {
    expect(readListValue(s, "", { listId: "devices" } as never)).toMatchObject({ ok: false });
    expect(readListValue(s, "", { listId: "services" })).toMatchObject({ ok: true, value: { id: "s1" } });
  });
});

describe("labels", () => {
  it("uses the label path, else the whole item", () => {
    expect(itemLabel(list("services"), body.services[0])).toBe("Mobile");
    expect(itemLabel(list("services", { labelPath: "" }), { a: 1 })).toBe('{"a":1}');
  });
});

describe("what a call waits for", () => {
  const customer: ToolCall = { ...newCall("customer", "Customer"), id: "customer", lists: [list("services", { choose: { kind: "ask" } }), list("devices")] };
  const status: ToolCall = { ...newCall("status", "Status"), id: "status" };
  const reader = (mapping: ToolCall["mappings"]): ToolCall => ({ ...newCall("r", "Reader"), id: "reader", mappings: mapping });
  const calls = (...cs: ToolCall[]) => new Map(cs.map((c) => [c.id, c]));

  it("a plain field of the whole response needs only the call", () => {
    const r = reader({ a: { call: { callId: "customer", path: "$.name" } } });
    expect(callNeeds(r, null, calls(customer, status))).toEqual([{ callId: "customer", lists: [] }]);
  });
  it("a value read from an ask list needs that pick; a show-only or first-item list does not", () => {
    const asks = reader({ a: { call: { callId: "customer", path: "$.id", list: { listId: "services" } } } });
    expect(callNeeds(asks, null, calls(customer))).toEqual([{ callId: "customer", lists: ["services"] }]);
    const first = reader({ a: { call: { callId: "customer", path: "$.serial", list: { listId: "devices", item: { kind: "index", index: 0 } } } } });
    expect(callNeeds(first, null, calls(customer))).toEqual([{ callId: "customer", lists: [] }]);
  });
  it("a where rule also needs the call its value comes from", () => {
    const r = reader({ a: { call: { callId: "customer", path: "$.id", list: { listId: "devices", item: { kind: "where", field: "$.serviceId", op: "eq", value: { call: { callId: "status", path: "$.id" } } } } } } });
    expect(callNeeds(r, null, calls(customer, status)).map((n) => n.callId).sort()).toEqual(["customer", "status"]);
  });
  it("a list inside a list needs the pick of the list it sits inside", () => {
    const c: ToolCall = { ...customer, lists: [...(customer.lists ?? []), list("features", { parentListId: "services", path: "$.features" })] };
    const r = reader({ a: { call: { callId: "customer", path: "$.code", list: { listId: "features", item: { kind: "index", index: 0 } } } } });
    expect(callNeeds(r, null, calls(c))).toEqual([{ callId: "customer", lists: ["services"] }]);
  });
  it("only placeholders in `only` count", () => {
    const r = reader({ a: { call: { callId: "customer", path: "$.name" } }, b: { call: { callId: "status", path: "$.x" } } });
    expect(callNeeds(r, ["b"], calls(customer, status))).toEqual([{ callId: "status", lists: [] }]);
  });
  it("which lists the user is asked about: own rule ask, or read with the ask rule", () => {
    const tool = { ...newTool("T"), calls: [customer] };
    expect(listsToAsk(tool, customer)).toEqual(["services"]);
    const viaRef = { ...tool, calls: [customer, reader({ a: { call: { callId: "customer", path: "$.serial", list: { listId: "devices", item: { kind: "ask" } } } } })] };
    expect(listsToAsk(viaRef, customer)).toEqual(["services", "devices"]);
    const viaBlock = { ...tool, blocks: [newBlock("fields", 0, { callId: "customer", fields: [{ path: "$.serial", label: "", format: "text", list: { listId: "devices", item: { kind: "ask" } } }] })] };
    expect(listsToAsk(viaBlock, customer)).toEqual(["services", "devices"]);
  });
});

describe("toolUsesLists", () => {
  it("is false for a tool with none of the new fields, and true for each new field", () => {
    const plain = { ...newTool("T"), calls: [newCall("r", "A")], blocks: [newBlock("table", 0, { callId: "x" })] };
    expect(toolUsesLists(plain)).toBe(false);
    expect(toolUsesLists({ ...plain, calls: [{ ...plain.calls[0], lists: [list("a")] }] })).toBe(true);
    expect(toolUsesLists({ ...plain, calls: [{ ...plain.calls[0], mappings: { p: { call: { callId: "x", path: "", list: { listId: "a" } } } } }] })).toBe(true);
    expect(toolUsesLists({ ...plain, blocks: [{ ...plain.blocks[0], listId: "a" }] })).toBe(true);
    expect(toolUsesLists({ ...plain, blocks: [newBlock("fields", 0, { fields: [{ path: "", label: "", format: "text", list: { listId: "a" } }] })] })).toBe(true);
  });
});

