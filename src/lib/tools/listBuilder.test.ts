import { describe, expect, it } from "vitest";
import { callGives, callNeeds, setPickRow, setMappingSource } from "./builder";
import { listSource, readCallField } from "./engine";
import {
  addFoundList,
  addListByPath,
  addTableBesideEntry,
  addListTable,
  choiceKind,
  choiceOfKind,
  ensureLists,
  fieldIsPicked,
  findLists,
  listEntryOf,
  listHasTable,
  listOutline,
  mappingIsPicked,
  openItemFields,
  pickHasNoTable,
  pickMappingPath,
  removeList,
  ruleKind,
  ruleOfKind,
  setEntryChoice,
  setListShow,
  splitListPath,
  toggleListEntry,
  toggleListField,
  updateList,
} from "./listBuilder";
import { choiceText, refBreadcrumb } from "./listText";
import { convertPickRow } from "./lists";
import { sampleFindRequest, sampleTool } from "./sample";
import { cleanTools, validateTool } from "./tools";
import type { CallResult, Tool } from "./types";

const find = sampleFindRequest();

const customer = {
  name: "Ada",
  data: { customer: { devices: [{ model: "Pixel 9", imei: "3501", status: "active", services: [{ id: "s1" }] }, { model: "iPad", imei: "3502", status: "lost", services: [] }] } },
  invoices: [{ number: "INV-1", amount: 40 }],
  tags: ["a", "b"],
};

function done(callId: string, body: unknown, picks?: CallResult["picks"]): CallResult {
  const text = JSON.stringify(body);
  return { callId, name: callId, state: "done", status: 200, response: { status: 200, statusText: "OK", headers: [], body: text, sizeBytes: text.length, durationMs: 1 }, ...(picks ? { picks } : {}) };
}

describe("findLists", () => {
  it("finds lists up to three objects down, with their size and first item", () => {
    const found = findLists(customer);
    expect(found.map((f) => [f.path, f.size])).toEqual([
      ["$.data.customer.devices", 2],
      ["$.invoices", 1],
      ["$.tags", 2],
    ]);
    expect(found[0].name).toBe("Devices");
    expect(found[0].first).toMatchObject({ model: "Pixel 9" });
  });

  it("does not go deeper than three objects", () => {
    expect(findLists({ a: { b: { c: { d: [1] } } } })).toEqual([]);
    expect(findLists({ a: { b: { c: [1] } } }).map((f) => f.path)).toEqual(["$.a.b.c"]);
  });

  it("finds lists inside the items of a list, with paths read from the item", () => {
    const [devices] = findLists(customer);
    expect(devices.children.map((c) => [c.path, c.size])).toEqual([["$.services", 1]]);
  });

  it("takes a response that is a list as '$'", () => {
    const found = findLists([{ id: 1 }, { id: 2 }]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: "$", name: "Items", size: 2 });
  });

  it("finds nothing in a response with no lists, or no JSON", () => {
    expect(findLists({ a: 1 })).toEqual([]);
    expect(findLists(undefined)).toEqual([]);
  });
});

describe("adding, matching and removing lists", () => {
  const base = sampleTool();
  const callId = "c-devices";
  const found = findLists(customer);

  it("adds a found list set to show only, named and labelled from the sample", () => {
    const { tool, list } = addFoundList(base, callId, found[0]);
    expect(list).toMatchObject({ name: "Devices", path: "$.data.customer.devices", choose: { kind: "none" }, labelPath: "$.model" });
    expect(tool.calls.find((c) => c.id === callId)!.lists).toHaveLength(1);
    expect(base.calls.find((c) => c.id === callId)!.lists).toBeUndefined();
  });

  it("gives a second list of the same name its own name", () => {
    const one = addFoundList(base, callId, found[1]).tool;
    const two = addFoundList(one, callId, found[1]).tool;
    expect(two.calls.find((c) => c.id === callId)!.lists!.map((l) => l.name)).toEqual(["Invoices", "Invoices 2"]);
  });

  it("does not add lists to a pick-a-row call", () => {
    const t = setPickRow(base, callId, { listPath: "$.devices", labelPath: "$.model" });
    expect(addFoundList(t, callId, found[0]).list).toBeNull();
    expect(addListByPath(t, callId, "$.x").list).toBeNull();
  });

  it("does not turn on pick-a-row for a call that has lists", () => {
    const t = addFoundList(base, callId, found[0]).tool;
    expect(setPickRow(t, callId, { listPath: "$", labelPath: "" }).calls.find((c) => c.id === callId)!.pickRow).toBeUndefined();
  });

  it("matches the call's lists with the sample, listing the ones not added yet", () => {
    const { tool, list } = addFoundList(base, callId, found[0]);
    const call = tool.calls.find((c) => c.id === callId)!;
    const outline = listOutline(call, found);
    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0].found?.size).toBe(2);
    expect(outline.nodes[0].suggestions.map((s) => s.name)).toEqual(["Services"]);
    expect(outline.suggestions.map((s) => s.name)).toEqual(["Invoices", "Tags"]);
    const inner = addFoundList(tool, callId, found[0].children[0], list!.id).tool.calls.find((c) => c.id === callId)!;
    const o2 = listOutline(inner, found);
    expect(o2.nodes[0].children).toHaveLength(1);
    expect(o2.nodes[0].suggestions).toEqual([]);
  });

  it("adds a list by typed path, shown as not in the sample", () => {
    const { tool, list } = addListByPath(base, callId, "$.x.items");
    expect(list).toMatchObject({ name: "Items", path: "$.x.items", labelPath: "" });
    expect(listOutline(tool.calls.find((c) => c.id === callId)!, found).nodes[0].found).toBeUndefined();
  });

  it("removes a list with the lists inside it, and the call drops an empty lists field", () => {
    const a = addFoundList(base, callId, found[0]);
    const b = addFoundList(a.tool, callId, found[0].children[0], a.list!.id);
    const gone = removeList(b.tool, callId, a.list!.id);
    expect(gone.calls.find((c) => c.id === callId)!.lists).toBeUndefined();
  });

  it("leaves what reads a removed list as an unknown-list warning, not a save blocker", () => {
    const a = addFoundList(base, callId, found[0], undefined, { kind: "ask" });
    const picked = pickMappingPath({ ...a.tool }, "c-account", "accountId", callId, customer, "$.data.customer.devices[0].imei");
    expect(validateTool(picked, find).filter((p) => p.code === "unknown-list")).toEqual([]);
    const removed = removeList(picked, callId, a.list!.id);
    const problems = validateTool(removed, find).filter((p) => p.code === "unknown-list");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ level: "warning", callId: "c-account" });
    expect(problems[0].message).toContain("reads a list that was removed");
  });

  it("reports a block that shows a removed list", () => {
    const a = addFoundList(base, callId, found[0]);
    const t: Tool = { ...a.tool, blocks: a.tool.blocks.map((b) => (b.id === "b-devices" ? { ...b, listId: a.list!.id } : b)) };
    expect(validateTool(t, find).some((p) => p.code === "unknown-list")).toBe(false);
    const removed = removeList(t, callId, a.list!.id);
    expect(validateTool(removed, find).find((p) => p.code === "unknown-list")).toMatchObject({ blockId: "b-devices" });
  });
});

describe("a click on a value inside a list", () => {
  it("splits a path at the list it passes through", () => {
    const s = splitListPath(customer, "$.data.customer.devices[1].imei")!;
    expect(s.rest).toBe("$.imei");
    expect(s.lists.map((l) => l.path)).toEqual(["$.data.customer.devices"]);
    expect((s.lists[0].first as { model: string }).model).toBe("Pixel 9");
  });

  it("splits through a list inside a list item", () => {
    const s = splitListPath(customer, "$.data.customer.devices[0].services[0].id")!;
    expect(s.lists.map((l) => l.path)).toEqual(["$.data.customer.devices", "$.services"]);
    expect(s.rest).toBe("$.id");
  });

  it("takes an item of a list of plain values as '$'", () => {
    expect(splitListPath(customer, "$.tags[1]")).toMatchObject({ rest: "$", lists: [{ path: "$.tags" }] });
  });

  it("is null for a path through no list, or one that does not fit the sample", () => {
    expect(splitListPath(customer, "$.name")).toBeNull();
    expect(splitListPath(customer, "$.name[0]")).toBeNull();
    expect(splitListPath(customer, "$.missing[0].x")).toBeNull();
    expect(splitListPath(customer, "$.data[")).toBeNull();
  });

  it("creates the list set to ask me to pick, and the mapping reads the item's field through it", () => {
    const t = pickMappingPath(sampleTool(), "c-account", "accountId", "c-devices", customer, "$.data.customer.devices[0].imei");
    const src = t.calls.find((c) => c.id === "c-devices")!;
    expect(src.lists).toHaveLength(1);
    expect(src.lists![0]).toMatchObject({ name: "Devices", path: "$.data.customer.devices", choose: { kind: "ask" }, labelPath: "$.model" });
    const m = t.calls.find((c) => c.id === "c-account")!.mappings.accountId;
    expect(m.call).toEqual({ callId: "c-devices", path: "$.imei", list: { listId: src.lists![0].id } });
    // The value is the picked item's field.
    const result = done("c-devices", customer, { [src.lists![0].id]: { index: 1 } });
    expect(readCallField(src, result, "$.imei", m.call!.list)).toBe("3502");
  });

  it("reuses a list that is already there, and a list that only shows is read with an explicit 'ask'", () => {
    const first = addFoundList(sampleTool(), "c-devices", findLists(customer)[0]).tool;
    const t = pickMappingPath(first, "c-account", "accountId", "c-devices", customer, "$.data.customer.devices[0].imei");
    const src = t.calls.find((c) => c.id === "c-devices")!;
    expect(src.lists).toHaveLength(1);
    expect(src.lists![0].choose).toEqual({ kind: "none" });
    expect(t.calls.find((c) => c.id === "c-account")!.mappings.accountId.call!.list).toEqual({ listId: src.lists![0].id, item: { kind: "ask" } });
  });

  it("keeps a path through no list as it was, dropping nothing else of the mapping", () => {
    const base = setMappingSource(sampleTool().calls[1], "accountId", "input", "subscriberId");
    const tool: Tool = { ...sampleTool(), calls: sampleTool().calls.map((c) => (c.id === "c-account" ? base : c)) };
    const t = pickMappingPath(tool, "c-account", "accountId", "c-subscriber", customer, "$.name");
    expect(t.calls.find((c) => c.id === "c-account")!.mappings.accountId).toEqual({ input: "subscriberId", call: { callId: "c-subscriber", path: "$.name" } });
  });

  it("does not make lists in a pick-a-row call: its sample is the picked row and paths stay as they were", () => {
    const tool = setPickRow(sampleTool(), "c-devices", { listPath: "$.devices", labelPath: "$.model" });
    const t = pickMappingPath(tool, "c-account", "accountId", "c-devices", customer, "$.data.customer.devices[0].imei");
    expect(t.calls.find((c) => c.id === "c-devices")!.lists).toBeUndefined();
    expect(t.calls.find((c) => c.id === "c-account")!.mappings.accountId.call).toEqual({ callId: "c-devices", path: "$.data.customer.devices[0].imei" });
  });

  it("makes a chain for a list inside a list, asking at each level", () => {
    const steps = splitListPath(customer, "$.data.customer.devices[0].services[0].id")!.lists;
    const r = ensureLists(sampleTool(), "c-devices", steps)!;
    const lists = r.tool.calls.find((c) => c.id === "c-devices")!.lists!;
    expect(lists.map((l) => [l.name, l.parentListId ? "inner" : "outer", l.choose.kind])).toEqual([
      ["Devices", "outer", "ask"],
      ["Services", "inner", "ask"],
    ]);
    expect(lists[1].parentListId).toBe(lists[0].id);
    expect(r.ref).toEqual({ listId: lists[1].id });
  });

  it("sets an outer list that only shows to ask, since an item has to be chosen to read inside it", () => {
    const outer = addFoundList(sampleTool(), "c-devices", findLists(customer)[0]).tool;
    const steps = splitListPath(customer, "$.data.customer.devices[0].services[0].id")!.lists;
    const r = ensureLists(outer, "c-devices", steps)!;
    expect(r.tool.calls.find((c) => c.id === "c-devices")!.lists![0].choose).toEqual({ kind: "ask" });
  });

  it("recognises the value a mapping reads when it is clicked again", () => {
    const t = pickMappingPath(sampleTool(), "c-account", "accountId", "c-devices", customer, "$.data.customer.devices[0].imei");
    const m = t.calls.find((c) => c.id === "c-account")!.mappings.accountId;
    const src = t.calls.find((c) => c.id === "c-devices")!;
    expect(mappingIsPicked(src, m, customer, "$.data.customer.devices[1].imei")).toBe(true);
    expect(mappingIsPicked(src, m, customer, "$.data.customer.devices[0].model")).toBe(false);
    expect(mappingIsPicked(src, m, customer, "$.name")).toBe(false);
  });
});

describe("fields of a block inside a list", () => {
  const withBlock = (): Tool => {
    const t = sampleTool();
    return { ...t, blocks: t.blocks.map((b) => (b.id === "b-subscriber" ? { ...b, callId: "c-devices", fields: [] } : b)) };
  };

  it("adds a field read from an item of the list, with a label and format from the sample", () => {
    const t = toggleListField(withBlock(), "b-subscriber", customer, "$.data.customer.devices[0].imei")!;
    const block = t.blocks.find((b) => b.id === "b-subscriber")!;
    const list = t.calls.find((c) => c.id === "c-devices")!.lists![0];
    expect(block.fields).toEqual([{ path: "$.imei", label: "Imei", format: "text", list: { listId: list.id } }]);
  });

  it("removes the field when it is clicked again", () => {
    const once = toggleListField(withBlock(), "b-subscriber", customer, "$.data.customer.devices[0].imei")!;
    const twice = toggleListField(once, "b-subscriber", customer, "$.data.customer.devices[1].imei")!;
    expect(twice.blocks.find((b) => b.id === "b-subscriber")!.fields).toEqual([]);
  });

  it("keeps a list field and a plain field of the same path apart", () => {
    const t = toggleListField(withBlock(), "b-subscriber", customer, "$.data.customer.devices[0].model")!;
    const block = t.blocks.find((b) => b.id === "b-subscriber")!;
    const call = t.calls.find((c) => c.id === "c-devices")!;
    expect(fieldIsPicked(call, block, customer, "$.data.customer.devices[0].model")).toBe(true);
    expect(fieldIsPicked(call, block, customer, "$.model")).toBe(false);
    expect(fieldIsPicked(call, { ...block, fields: [{ path: "$.model", label: "", format: "text" }] }, customer, "$.model")).toBe(true);
  });

  it("is null outside a list, so the click works as it did", () => {
    expect(toggleListField(withBlock(), "b-subscriber", customer, "$.name")).toBeNull();
  });

  it("a number block takes one field; a second click on another replaces it", () => {
    let t = withBlock();
    t = { ...t, blocks: t.blocks.map((b) => (b.id === "b-subscriber" ? { ...b, type: "number" as const } : b)) };
    t = toggleListField(t, "b-subscriber", customer, "$.data.customer.devices[0].imei")!;
    t = toggleListField(t, "b-subscriber", customer, "$.data.customer.devices[0].model")!;
    expect(t.blocks.find((b) => b.id === "b-subscriber")!.fields.map((f) => f.path)).toEqual(["$.model"]);
  });

  it("shows the field in the call's gives and the list in a mapping's needs", () => {
    const t = toggleListField(withBlock(), "b-subscriber", customer, "$.data.customer.devices[0].imei")!;
    expect(callGives(t, t.calls.find((c) => c.id === "c-devices")!)).toContain("Imei");
    const m = pickMappingPath(t, "c-account", "accountId", "c-devices", customer, "$.data.customer.devices[0].imei");
    const needs = callNeeds(m, m.calls.find((c) => c.id === "c-account")!, find)!;
    expect(needs.find((n) => n.placeholder === "accountId")!.from[0].text).toBe("Devices › Devices › row you pick › imei");
  });
});

describe("rules in words", () => {
  it("reads first, last and row number from an index rule", () => {
    expect(ruleKind({ kind: "index", index: 0 })).toBe("first");
    expect(ruleKind({ kind: "index", index: -1 })).toBe("last");
    expect(ruleKind({ kind: "index", index: 2 })).toBe("index");
    expect(ruleOfKind("first")).toEqual({ kind: "index", index: 0 });
    expect(ruleOfKind("last")).toEqual({ kind: "index", index: -1 });
    expect(ruleOfKind("index", { kind: "index", index: 4 })).toEqual({ kind: "index", index: 4 });
    expect(ruleOfKind("index", { kind: "ask" })).toEqual({ kind: "index", index: 1 });
  });

  it("keeps the condition when switching back to 'where', and starts one on the suggested field", () => {
    const w = { kind: "where" as const, field: "$.status", op: "ne" as const, value: { fixed: "lost" } };
    expect(ruleOfKind("where", w)).toBe(w);
    expect(ruleOfKind("where", { kind: "ask" }, "$.model")).toEqual({ kind: "where", field: "$.model", op: "eq", value: { fixed: "" } });
  });

  it("maps a value's choice to a kind and back; 'same as the list' is no choice", () => {
    expect(choiceKind(undefined)).toBe("list");
    expect(choiceKind({ kind: "all", join: "," })).toBe("all");
    expect(choiceKind({ kind: "count" })).toBe("count");
    expect(choiceKind({ kind: "ask" })).toBe("ask");
    expect(choiceOfKind("list", { kind: "ask" })).toBeUndefined();
    expect(choiceOfKind("all", undefined)).toEqual({ kind: "all", join: ", " });
    expect(choiceOfKind("count", undefined)).toEqual({ kind: "count" });
    expect(choiceOfKind("last", { kind: "all", join: "," })).toEqual({ kind: "index", index: -1 });
  });

  it("describes the choices", () => {
    expect(choiceText({ kind: "ask" })).toBe("row you pick");
    expect(choiceText({ kind: "index", index: 0 })).toBe("first");
    expect(choiceText({ kind: "index", index: -1 })).toBe("last");
    expect(choiceText({ kind: "index", index: 2 })).toBe("row 3");
    expect(choiceText({ kind: "where", field: "$.status", op: "eq", value: { fixed: "active" } })).toBe("first where status = active");
    expect(choiceText({ kind: "where", field: "$.status", op: "ne", value: { input: "x" } }, sampleTool())).toBe("first where status ≠ x");
    expect(choiceText({ kind: "all", join: ", " })).toBe("all joined with “, ”");
    expect(choiceText({ kind: "count", where: { field: "$.status", op: "eq", value: { fixed: "lost" } } })).toBe("how many where status = lost");
  });

  it("makes a breadcrumb through lists, and names a removed list", () => {
    const t = pickMappingPath(sampleTool(), "c-account", "accountId", "c-devices", customer, "$.data.customer.devices[0].services[0].id");
    const src = t.calls.find((c) => c.id === "c-devices")!;
    const ref = t.calls.find((c) => c.id === "c-account")!.mappings.accountId.call!.list;
    expect(refBreadcrumb(t, src, ref, "$.id")).toEqual(["Devices", "Devices", "Services", "row you pick", "id"]);
    expect(refBreadcrumb(t, src, { listId: "gone" }, "$.id")).toEqual(["Devices", "a removed list", "id"]);
    expect(refBreadcrumb(t, undefined, ref, "$.id")).toEqual(["a removed request", "id"]);
    expect(refBreadcrumb(t, src, undefined, "$.a.b")).toEqual(["Devices", "a.b"]);
  });
});

describe("existing tools keep working", () => {
  it("a pick-a-row call is converted only when asked, with the same values", () => {
    let tool = setPickRow(sampleTool(), "c-devices", { listPath: "$.devices", labelPath: "$.model" });
    tool = { ...tool, calls: tool.calls.map((c) => (c.id === "c-account" ? { ...c, mappings: { accountId: { call: { callId: "c-devices", path: "$.imei" } } } } : c)) };
    const result = { ...done("c-devices", { devices: [{ model: "A", imei: "1" }, { model: "B", imei: "2" }] }), picked: { index: 1 } };
    const legacy = tool.calls.find((c) => c.id === "c-devices")!;
    expect(readCallField(legacy, result, "$.imei")).toBe("2");
    expect(tool.calls.find((c) => c.id === "c-devices")!.pickRow).toBeDefined();
    const converted = convertPickRow(tool, "c-devices");
    const call = converted.calls.find((c) => c.id === "c-devices")!;
    expect(call.pickRow).toBeUndefined();
    expect(call.lists).toHaveLength(1);
    const ref = converted.calls.find((c) => c.id === "c-account")!.mappings.accountId.call!.list;
    expect(readCallField(call, result, "$.imei", ref)).toBe("2");
    expect(listSource(call, result).picks).toEqual({ [call.lists![0].id]: { index: 1 } });
  });

  it("a tool with lists made here survives loading and saving unchanged", () => {
    let t = pickMappingPath(sampleTool(), "c-account", "accountId", "c-devices", customer, "$.data.customer.devices[0].imei");
    t = toggleListField({ ...t, blocks: t.blocks.map((b) => (b.id === "b-subscriber" ? { ...b, callId: "c-devices", fields: [] } : b)) }, "b-subscriber", customer, "$.data.customer.devices[0].model")!;
    const list = t.calls.find((c) => c.id === "c-devices")!.lists![0];
    t = updateList(t, "c-devices", list.id, { choose: { kind: "where", field: "$.status", op: "eq", value: { fixed: "active" } } });
    expect(cleanTools(JSON.parse(JSON.stringify([t])))).toEqual([t]);
  });

  it("a tool that never uses lists is not given any", () => {
    expect(JSON.stringify(sampleTool())).not.toContain("lists");
  });
});

describe("a list you are asked to pick in needs a table", () => {
  const callId = "c-devices";
  const found = findLists(customer);

  it("only an ask list with no table showing it is a problem", () => {
    const shown = addFoundList(sampleTool(), callId, found[0]);
    const call = (t: Tool) => t.calls.find((c) => c.id === callId)!;
    expect(pickHasNoTable(shown.tool, call(shown.tool), shown.list!.id)).toBe(false);
    const ask = updateList(shown.tool, callId, shown.list!.id, { choose: { kind: "ask" } });
    expect(pickHasNoTable(ask, call(ask), shown.list!.id)).toBe(true);
    const withTable = addListTable(ask, callId, shown.list!.id);
    expect(listHasTable(withTable, callId, shown.list!.id)).toBe(true);
    expect(pickHasNoTable(withTable, call(withTable), shown.list!.id)).toBe(false);
  });

  it("a list asked only by one value counts too", () => {
    const t = pickMappingPath(sampleTool(), "c-account", "accountId", callId, customer, "$.data.customer.devices[0].imei");
    const call = t.calls.find((c) => c.id === callId)!;
    expect(pickHasNoTable(t, call, call.lists![0].id)).toBe(true);
  });

  it("adds a table block as a row of its own with the label as its column", () => {
    const shown = addFoundList(sampleTool(), callId, found[0]);
    const t = addListTable(shown.tool, callId, shown.list!.id);
    const block = t.blocks[t.blocks.length - 1];
    expect(block).toMatchObject({ type: "table", title: "Devices", callId, listId: shown.list!.id, fields: [{ path: "$.model", label: "Model", format: "text" }] });
    expect(t.blocks.filter((b) => b.row === block.row)).toHaveLength(1);
    expect(addListTable(sampleTool(), callId, "gone")).toEqual(sampleTool());
  });
});

describe("clicking a list row of a Fields block", () => {
  const sample = { name: "Ada", servItems: [{ name: "Roaming", id: 1, features: ["a", "b"] }, { name: "Voicemail", id: 2, features: [] }], tags: ["CID", "VM"] };
  const base = (type: "fields" | "number" = "fields"): Tool => {
    const t = sampleTool();
    return { ...t, blocks: t.blocks.map((b) => (b.id === "b-subscriber" ? { ...b, type, callId: "c-devices", fields: [] } : b)) };
  };
  const blockOf = (t: Tool) => t.blocks.find((b) => b.id === "b-subscriber")!;
  const callOf = (t: Tool) => t.calls.find((c) => c.id === "c-devices")!;

  it("adds a how-many entry for a list of records, on a list that only shows (so nothing waits for a pick)", () => {
    const t = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    const list = callOf(t).lists![0];
    expect(list).toMatchObject({ path: "$.servItems", name: "Serv items", choose: { kind: "none" }, labelPath: "$.name" });
    expect(blockOf(t).fields).toEqual([{ path: "$", label: "Serv items", format: "text", list: { listId: list.id, item: { kind: "count" } } }]);
    expect(listEntryOf(callOf(t), blockOf(t).fields[0], sample)).toMatchObject({ show: "count" });
  });

  it("adds a joined entry for a list of plain values", () => {
    const t = toggleListEntry(base(), "b-subscriber", sample, "$.tags")!;
    const f = blockOf(t).fields[0];
    expect(f).toMatchObject({ path: "$", list: { item: { kind: "all", join: ", " } } });
    const call = callOf(t);
    expect(readCallField(call, done("c-devices", sample), f.path, f.list, () => null)).toBe("CID, VM");
  });

  it("reads the entry: how many and joined names", () => {
    const counted = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    const f = blockOf(counted).fields[0];
    expect(readCallField(callOf(counted), done("c-devices", sample), f.path, f.list, () => null)).toBe(2);
    const joined = setListShow(counted, "b-subscriber", 0, sample, "joined");
    const j = blockOf(joined).fields[0];
    expect(j).toMatchObject({ path: "$.name", list: { item: { kind: "all", join: ", " } } });
    expect(readCallField(callOf(joined), done("c-devices", sample), j.path, j.list, () => null)).toBe("Roaming, Voicemail");
  });

  it("is picked while its entry is there, and a second click takes the entry and its list away", () => {
    const t = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    expect(fieldIsPicked(callOf(t), blockOf(t), sample, "$.servItems")).toBe(true);
    const gone = toggleListEntry(t, "b-subscriber", sample, "$.servItems")!;
    expect(blockOf(gone).fields).toEqual([]);
    expect(callOf(gone).lists).toBeUndefined();
  });

  it("does not mark the items of a list as picked because the whole list is shown", () => {
    const t = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    expect(fieldIsPicked(callOf(t), blockOf(t), sample, "$.servItems[0]")).toBe(false);
    const tags = toggleListEntry(base(), "b-subscriber", sample, "$.tags")!;
    expect(fieldIsPicked(callOf(tags), blockOf(tags), sample, "$.tags[0]")).toBe(false);
  });

  it("keeps a list the user set a rule on when its entry goes", () => {
    let t = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    t = updateList(t, "c-devices", callOf(t).lists![0].id, { choose: { kind: "ask" } });
    const gone = toggleListEntry(t, "b-subscriber", sample, "$.servItems")!;
    expect(callOf(gone).lists).toHaveLength(1);
  });

  it("reuses the call's list for the path", () => {
    const withList = addFoundList(base(), "c-devices", findLists(sample)[0]).tool;
    const t = toggleListEntry(withList, "b-subscriber", sample, "$.servItems")!;
    expect(callOf(t).lists).toHaveLength(1);
    expect(blockOf(t).fields[0].list!.listId).toBe(callOf(withList).lists![0].id);
  });

  it("leaves a saved plain field alone: the click removes it as before, and nothing is converted", () => {
    const saved: Tool = { ...base(), blocks: base().blocks.map((b) => (b.id === "b-subscriber" ? { ...b, fields: [{ path: "$.servItems", label: "Items", format: "text" as const }] } : b)) };
    expect(toggleListEntry(saved, "b-subscriber", sample, "$.servItems")).toBeNull();
    expect(listEntryOf(callOf(saved), blockOf(saved).fields[0], sample)).toEqual({ show: "json" });
    expect(fieldIsPicked(callOf(saved), blockOf(saved), sample, "$.servItems")).toBe(true);
  });

  it("is null for a value that is not a list, a list inside a list item, a table or JSON block, and a pick-a-row call", () => {
    expect(toggleListEntry(base(), "b-subscriber", sample, "$.name")).toBeNull();
    expect(toggleListEntry(base(), "b-subscriber", sample, "$.servItems[0].features")).toBeNull();
    const t = base();
    for (const type of ["table", "json"] as const) expect(toggleListEntry({ ...t, blocks: t.blocks.map((b) => (b.id === "b-subscriber" ? { ...b, type } : b)) }, "b-subscriber", sample, "$.servItems")).toBeNull();
    const pick = { ...t, calls: t.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "$.servItems", labelPath: "$.name" } } : c)) };
    expect(toggleListEntry(pick, "b-subscriber", sample, "$.servItems")).toBeNull();
  });

  it("keeps the filter and the separator when the entry changes how it shows", () => {
    let t = setListShow(toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!, "b-subscriber", 0, sample, "joined");
    t = setEntryChoice(t, "b-subscriber", 0, { item: { kind: "all", join: " | ", where: { field: "$.id", op: "eq", value: { fixed: "1" } } } });
    t = setEntryChoice(t, "b-subscriber", 0, { path: "$.id" });
    const counted = setListShow(t, "b-subscriber", 0, sample, "count");
    expect(blockOf(counted).fields[0].list!.item).toEqual({ kind: "count", where: { field: "$.id", op: "eq", value: { fixed: "1" } } });
    const back = setListShow(counted, "b-subscriber", 0, sample, "joined");
    expect(blockOf(back).fields[0].list!.item).toMatchObject({ kind: "all", join: ", " });
  });

  it("switches to JSON: the plain field again, and the list made for it goes", () => {
    const t = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    const plain = setListShow(t, "b-subscriber", 0, sample, "json");
    expect(blockOf(plain).fields).toEqual([{ path: "$.servItems", label: "Serv items", format: "text" }]);
    expect(callOf(plain).lists).toBeUndefined();
    const again = setListShow(plain, "b-subscriber", 0, sample, "count");
    expect(blockOf(again).fields[0].list!.item).toEqual({ kind: "count" });
  });

  it("switches a saved plain field to joined or how many, and only then writes anything", () => {
    const saved: Tool = { ...base(), blocks: base().blocks.map((b) => (b.id === "b-subscriber" ? { ...b, fields: [{ path: "$.servItems", label: "Items", format: "text" as const }] } : b)) };
    const t = setListShow(saved, "b-subscriber", 0, sample, "count");
    expect(blockOf(t).fields[0]).toMatchObject({ path: "$", label: "Items", list: { item: { kind: "count" } } });
    expect(setListShow(saved, "b-subscriber", 0, sample, "json")).toBe(saved);
  });

  it("Its own Table block: adds an expandable table on the list in the block's row, and the entry becomes how many", () => {
    const roomy = base();
    roomy.blocks = roomy.blocks.filter((b) => b.id !== "b-status");
    const joined = setListShow(toggleListEntry(roomy, "b-subscriber", sample, "$.servItems")!, "b-subscriber", 0, sample, "joined");
    const r = addTableBesideEntry(joined, "b-subscriber", 0, sample)!;
    const table = r.tool.blocks.find((b) => b.id === r.tableId)!;
    const list = callOf(r.tool).lists![0];
    expect(table).toMatchObject({ type: "table", title: "Serv items", callId: "c-devices", listId: list.id, expandable: true, fields: [{ path: "$.name" }] });
    expect(blockOf(r.tool).fields[0].list!.item).toEqual({ kind: "count" });
    const subscriber = r.tool.blocks.find((b) => b.id === "b-subscriber")!;
    expect(table.row).toBe(subscriber.row);
    expect(r.tool.blocks.findIndex((b) => b.id === r.tableId)).toBe(r.tool.blocks.findIndex((b) => b.id === "b-subscriber") + 1);
    expect(listHasTable(r.tool, "c-devices", list.id)).toBe(true);
  });

  it("Its own Table block goes in a new row when the row is full, and no row holds more than three blocks", () => {
    const t = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    // Row 1 of the sample page already has three blocks.
    const r = addTableBesideEntry(t, "b-subscriber", 0, sample)!;
    const rows = new Map<number, number>();
    for (const b of r.tool.blocks) rows.set(b.row, (rows.get(b.row) ?? 0) + 1);
    expect(Math.max(...rows.values())).toBeLessThanOrEqual(3);
    expect(r.tool.blocks.find((b) => b.id === r.tableId)!.row).toBe(r.tool.blocks.find((b) => b.id === "b-subscriber")!.row + 1);
  });

  it("One item's fields: takes the entry away and says to open the first item", () => {
    const t = toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!;
    const r = openItemFields(t, "b-subscriber", 0, sample)!;
    expect(r.reveal).toBe("$.servItems[0]");
    expect(blockOf(r.tool).fields).toEqual([]);
    expect(callOf(r.tool).lists).toBeUndefined();
  });

  it("a Number block holds one entry, and a click replaces it", () => {
    const t = toggleListEntry(base("number"), "b-subscriber", sample, "$.tags")!;
    const t2 = toggleListEntry(t, "b-subscriber", sample, "$.servItems")!;
    expect(blockOf(t2).fields).toHaveLength(1);
    expect(blockOf(t2).fields[0].list!.item).toEqual({ kind: "count" });
  });

  it("saves and loads unchanged through cleanTools", () => {
    const t = setListShow(toggleListEntry(base(), "b-subscriber", sample, "$.servItems")!, "b-subscriber", 0, sample, "joined");
    expect(cleanTools([JSON.parse(JSON.stringify(t))])[0]).toEqual(t);
  });
});
