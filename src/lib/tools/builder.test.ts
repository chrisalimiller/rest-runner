import { describe, expect, it } from "vitest";
import { readPath } from "../testing/jsonPath";
import {
  addBlock,
  addCall,
  addFieldByPath,
  addInput,
  blankBlock,
  blockSample,
  buildTree,
  callGives,
  callGroups,
  callNeeds,
  childPath,
  colourEntries,
  colourMapText,
  deleteBlock,
  dependentCallIds,
  duplicateBlock,
  filterBlockTypes,
  groupRows,
  guessFormat,
  guessLabelPath,
  humanize,
  isDirty,
  isPicked,
  labelForPath,
  listPathOptions,
  mappingSources,
  moveBlock,
  moveField,
  normalizeBlocks,
  parseOptions,
  pruneMappings,
  pruneToolMappings,
  removeCall,
  removeField,
  removeInput,
  rowHasRoom,
  saveBlockers,
  setMappingSource,
  setPickRow,
  sourceCalls,
  stepBlock,
  tidyTool,
  togglePath,
  uniqueName,
  updateField,
  updateInput,
  type TreeNode,
} from "./builder";
import { sampleFindRequest, sampleTool } from "./sample";
import { newBlock, newCall, newTool } from "./tools";
import { MAX_BLOCKS_PER_ROW, type CallResult, type ToolBlock } from "./types";
import { parseColourMap } from "./view";

const find = sampleFindRequest();

function b(id: string, row: number): ToolBlock {
  return newBlock("note", row, { id });
}
function layout(blocks: ToolBlock[]): string {
  return groupRows(blocks)
    .map((r) => r.map((x) => x.id).join(","))
    .join(" | ");
}
function done(body: unknown): CallResult {
  const text = JSON.stringify(body);
  return { callId: "x", name: "x", state: "done", status: 200, response: { status: 200, statusText: "OK", headers: [], body: text, sizeBytes: text.length, durationMs: 1 } };
}

describe("rows", () => {
  it("normalizes gaps and over-full rows", () => {
    const out = normalizeBlocks([b("a", 5), b("b", 5), b("c", 5), b("d", 5), b("e", 9)]);
    expect(layout(out)).toBe("a,b,c | d | e");
    expect(out.map((x) => x.row)).toEqual([0, 0, 0, 1, 2]);
  });

  it("keeps array order inside a row and sorts rows", () => {
    expect(layout(normalizeBlocks([b("a", 2), b("b", 0), b("c", 2)]))).toBe("b | a,c");
  });

  it("adds a block as a new last row, or at a row", () => {
    const blocks = [b("a", 0), b("b", 1)];
    expect(layout(addBlock(blocks, b("n", 0)))).toBe("a | b | n");
    expect(layout(addBlock(blocks, b("n", 0), 1))).toBe("a | n | b");
    expect(layout(addBlock(blocks, b("n", 0), 99))).toBe("a | b | n");
  });

  it("deletes a block and closes the gap", () => {
    const out = deleteBlock([b("a", 0), b("b", 1), b("c", 2)], "b");
    expect(layout(out)).toBe("a | c");
    expect(out.map((x) => x.row)).toEqual([0, 1]);
  });

  it("duplicates into the same row when there is room, else below", () => {
    expect(layout(duplicateBlock([b("a", 0), b("z", 1)], "a", "a2"))).toBe("a,a2 | z");
    expect(layout(duplicateBlock([b("a", 0), b("b", 0), b("c", 0), b("z", 1)], "b", "b2"))).toBe("a,b,c | b2 | z");
    const copy = duplicateBlock([newBlock("fields", 0, { id: "a", fields: [{ path: "$.x", label: "X", format: "text" }] })], "a", "a2");
    expect(copy[1].fields).toEqual(copy[0].fields);
    expect(copy[1].fields[0]).not.toBe(copy[0].fields[0]);
  });
});

describe("moving blocks (drop targets)", () => {
  const base = () => [b("a", 0), b("b", 1), b("c", 1), b("d", 2)];

  it("drops between rows to start a new row", () => {
    expect(layout(moveBlock(base(), "c", { kind: "new-row", index: 0 }))).toBe("c | a | b | d");
    expect(layout(moveBlock(base(), "a", { kind: "new-row", index: 3 }))).toBe("b,c | d | a");
    expect(layout(moveBlock(base(), "d", { kind: "new-row", index: 1 }))).toBe("a | d | b,c");
  });

  it("drops into a row at a position", () => {
    expect(layout(moveBlock(base(), "a", { kind: "in-row", row: 1, position: 1 }))).toBe("b,a,c | d");
    expect(layout(moveBlock(base(), "d", { kind: "in-row", row: 0, position: 0 }))).toBe("d,a | b,c");
  });

  it("reorders inside its own row", () => {
    expect(layout(moveBlock(base(), "b", { kind: "in-row", row: 1, position: 2 }))).toBe("a | c,b | d");
    expect(layout(moveBlock(base(), "c", { kind: "in-row", row: 1, position: 0 }))).toBe("a | c,b | d");
  });

  it("refuses a full row", () => {
    const full = [b("a", 0), b("b", 0), b("c", 0), b("d", 1)];
    expect(rowHasRoom(full, 0)).toBe(false);
    expect(rowHasRoom(full, 0, "a")).toBe(true);
    expect(moveBlock(full, "d", { kind: "in-row", row: 0, position: 1 })).toBe(full);
    // A block already in the full row can still move inside it.
    expect(layout(moveBlock(full, "a", { kind: "in-row", row: 0, position: 3 }))).toBe("b,c,a | d");
  });

  it("returns the same array when nothing would change", () => {
    const blocks = normalizeBlocks(base());
    expect(moveBlock(blocks, "a", { kind: "new-row", index: 0 })).toBe(blocks);
    expect(moveBlock(blocks, "a", { kind: "new-row", index: 1 })).toBe(blocks);
    expect(moveBlock(blocks, "b", { kind: "in-row", row: 1, position: 0 })).toBe(blocks);
    expect(moveBlock(blocks, "missing", { kind: "new-row", index: 0 })).toBe(blocks);
  });

  it("closes the row it left, and never leaves more than the maximum in a row", () => {
    const out = moveBlock(base(), "a", { kind: "in-row", row: 2, position: 0 });
    expect(layout(out)).toBe("b,c | a,d");
    for (const r of groupRows(out)) expect(r.length).toBeLessThanOrEqual(MAX_BLOCKS_PER_ROW);
    expect(out.map((x) => x.row)).toEqual([0, 0, 1, 1]);
  });
});

describe("moving blocks (keyboard steps)", () => {
  const base = () => [b("a", 0), b("b", 1), b("c", 1), b("d", 2)];

  it("left and right swap inside a row, and stop at the ends", () => {
    expect(layout(stepBlock(base(), "c", "left"))).toBe("a | c,b | d");
    expect(layout(stepBlock(base(), "b", "right"))).toBe("a | c,b | d");
    const blocks = normalizeBlocks(base());
    expect(stepBlock(blocks, "b", "left")).toBe(blocks);
    expect(stepBlock(blocks, "c", "right")).toBe(blocks);
  });

  it("up and down swap whole rows for a block on its own", () => {
    expect(layout(stepBlock(base(), "d", "up"))).toBe("a | d | b,c");
    expect(layout(stepBlock(base(), "a", "down"))).toBe("b,c | a | d");
    const blocks = normalizeBlocks(base());
    expect(stepBlock(blocks, "a", "up")).toBe(blocks);
    expect(stepBlock(blocks, "d", "down")).toBe(blocks);
  });

  it("up and down take a block out of a shared row into its own", () => {
    expect(layout(stepBlock(base(), "c", "up"))).toBe("a | c | b | d");
    expect(layout(stepBlock(base(), "b", "down"))).toBe("a | c | b | d");
  });
});

describe("new blocks", () => {
  it("an input block shows the first input no block shows yet", () => {
    const t = newTool();
    t.inputs = [
      { name: "a", label: "A", kind: "text" },
      { name: "b", label: "B", kind: "text" },
    ];
    t.blocks = [newBlock("input", 0, { inputName: "a" })];
    expect(blankBlock(t, "input").inputName).toBe("b");
  });

  it("uses the only call, or the first write call for an action", () => {
    const t = sampleTool();
    expect(blankBlock(t, "action").callId).toBe("c-suspend");
    expect(blankBlock(t, "fields").callId).toBeUndefined();
    const one = newTool();
    one.calls = [newCall("r", "Only")];
    expect(blankBlock(one, "table").callId).toBe(one.calls[0].id);
  });

  it("the slash menu filters by name and hint", () => {
    expect(filterBlockTypes("/").map((x) => x.type)).toHaveLength(8);
    expect(filterBlockTypes("/ta").map((x) => x.type)).toEqual(["table"]);
    expect(filterBlockTypes("/num").map((x) => x.type)).toEqual(["number"]);
    expect(filterBlockTypes("/button").map((x) => x.type)).toEqual(["action"]);
    expect(filterBlockTypes("/zzz")).toEqual([]);
  });
});

describe("calls", () => {
  it("names a second call of the same request differently", () => {
    let t = newTool();
    t.calls = [];
    const r = { id: "s360-account", name: "Get account", method: "GET" as const };
    t = addCall(t, r).tool;
    t = addCall(t, r).tool;
    t = addCall(t, r).tool;
    expect(t.calls.map((c) => c.name)).toEqual(["Get account", "Get account 2", "Get account 3"]);
    expect(new Set(t.calls.map((c) => c.requestId))).toEqual(new Set(["s360-account"]));
    expect(uniqueName("x", ["X"])).toBe("x 2");
  });

  it("a write method starts as a write call", () => {
    const { call } = addCall(newTool(), { id: "r", name: "Suspend", method: "POST" });
    expect(call.write).toBe(true);
    expect(addCall(newTool(), { id: "r", name: "Get", method: "GET" }).call.write).toBe(false);
  });

  it("removing a call frees the mappings and blocks that used it", () => {
    const t = removeCall(sampleTool(), "c-subscriber");
    expect(t.calls.find((c) => c.id === "c-account")!.mappings).toEqual({});
    const sub = t.blocks.find((x) => x.id === "b-subscriber")!;
    expect(sub.callId).toBeUndefined();
    expect(sub.fields).toEqual([]);
    expect(t.calls.find((c) => c.id === "c-devices")!.mappings.subscriberId).toEqual({ input: "subscriberId" });
  });

  it("removing a call keeps the other sources of a mapping", () => {
    const t = sampleTool();
    t.calls = t.calls.map((c) => (c.id === "c-account" ? { ...c, mappings: { accountId: { call: { callId: "c-subscriber", path: "$.account.id" }, fixed: "A-1" } } } : c));
    expect(removeCall(t, "c-subscriber").calls.find((c) => c.id === "c-account")!.mappings.accountId).toEqual({ fixed: "A-1" });
  });

  it("sets and clears pick-a-row", () => {
    let t = setPickRow(sampleTool(), "c-devices", { listPath: "$.devices", labelPath: "$.model" });
    expect(t.calls.find((c) => c.id === "c-devices")!.pickRow).toEqual({ listPath: "$.devices", labelPath: "$.model" });
    t = setPickRow(t, "c-devices", null);
    expect("pickRow" in t.calls.find((c) => c.id === "c-devices")!).toBe(false);
  });
});

describe("the calls column", () => {
  it("groups calls into steps by what they need", () => {
    const g = callGroups(sampleTool(), find);
    expect(g.ok).toBe(true);
    expect(g.groups.map((x) => x.label)).toEqual(["Step 1", "Step 2"]);
    expect(g.groups[0].calls.map((c) => c.id)).toEqual(["c-subscriber", "c-devices", "c-suspend"]);
    expect(g.groups[1].calls.map((c) => c.id)).toEqual(["c-account", "c-usage", "c-invoices", "c-plan"]);
  });

  it("reports a loop instead of groups", () => {
    const t = sampleTool();
    t.calls = t.calls.map((c) => (c.id === "c-subscriber" ? { ...c, mappings: { subscriberId: { call: { callId: "c-account", path: "$.id" } } } } : c));
    const g = callGroups(t, find);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.message).toMatch(/wait on each other/);
      expect(g.groups[0].label).toBe("Calls");
    }
    expect(saveBlockers(t, find).map((p) => p.code)).toEqual(["cycle"]);
  });

  it("says what a call needs and gives", () => {
    const t = sampleTool();
    const account = t.calls.find((c) => c.id === "c-account")!;
    expect(callNeeds(t, account, find)?.find((n) => n.placeholder === "accountId")).toEqual({ placeholder: "accountId", from: [{ kind: "call", text: "Subscriber › account.id" }] });
    const sub = t.calls.find((c) => c.id === "c-subscriber")!;
    // baseUrl and subscriberId, the first left to the environment.
    expect(callNeeds(t, sub, find)).toEqual([
      { placeholder: "baseUrl", from: [{ kind: "environment", text: "environment" }] },
      { placeholder: "subscriberId", from: [{ kind: "input", text: "Subscriber ID" }] },
    ]);
    expect(callGives(t, sub)).toEqual(expect.arrayContaining(["Name", "account.id", "account.planId", "whole response"]));
    expect(callNeeds(t, { ...account, requestId: "gone" }, find)).toBeNull();
  });

  it("only offers calls that would not make a loop", () => {
    const t = sampleTool();
    expect([...dependentCallIds(t, "c-subscriber", find)].sort()).toEqual(["c-account", "c-invoices", "c-plan", "c-usage"]);
    expect(sourceCalls(t, "c-subscriber", find).map((c) => c.id)).toEqual(["c-devices", "c-suspend"]);
    expect(sourceCalls(t, "c-account", find).map((c) => c.id)).toContain("c-subscriber");
    expect(sourceCalls(t, "c-account", find).map((c) => c.id)).not.toContain("c-account");
  });
});

describe("placeholder mappings", () => {
  const call = () => newCall("r", "Call");

  it("keeps input, call and fixed as a chain in engine order", () => {
    let c = setMappingSource(call(), "id", "fixed", "7");
    c = setMappingSource(c, "id", "input", "subscriberId");
    c = setMappingSource(c, "id", "call", { callId: "x", path: "$.id" });
    expect(c.mappings.id).toEqual({ fixed: "7", input: "subscriberId", call: { callId: "x", path: "$.id" } });
    expect(mappingSources(c.mappings.id)).toEqual(["input", "call", "fixed"]);
  });

  it("an empty fixed value is still a value", () => {
    const c = setMappingSource(call(), "id", "fixed", "");
    expect(c.mappings.id).toEqual({ fixed: "" });
  });

  it("removing the last source goes back to the environment", () => {
    let c = setMappingSource(call(), "id", "input", "a");
    c = setMappingSource(c, "id", "input", null);
    expect(c.mappings).toEqual({});
  });

  it("prunes mappings for placeholders the request no longer uses", () => {
    const c = { ...call(), mappings: { keep: { input: "a" }, gone: { fixed: "x" } } };
    expect(pruneMappings(c, ["keep"]).mappings).toEqual({ keep: { input: "a" } });
    expect(pruneMappings(c, ["keep", "gone"])).toBe(c);
  });

  it("prunes a whole tool, but not a call whose request is missing", () => {
    const t = sampleTool();
    t.calls = t.calls.map((c) => {
      if (c.id === "c-usage") return { ...c, mappings: { ...c.mappings, oldThing: { fixed: "1" } } };
      if (c.id === "c-plan") return { ...c, requestId: "gone", mappings: { ...c.mappings, oldThing: { fixed: "1" } } };
      return c;
    });
    const out = pruneToolMappings(t, find);
    expect(out.calls.find((c) => c.id === "c-usage")!.mappings.oldThing).toBeUndefined();
    expect(out.calls.find((c) => c.id === "c-plan")!.mappings.oldThing).toBeDefined();
    expect(pruneToolMappings(sampleTool(), find)).toEqual(sampleTool());
  });

  it("tidy keeps rows gap-free and prunes", () => {
    const t = sampleTool();
    t.blocks = [b("a", 4), b("b", 9)];
    expect(tidyTool(t, find).blocks.map((x) => x.row)).toEqual([0, 1]);
  });
});

describe("tool inputs", () => {
  it("adds inputs with unique names", () => {
    let t = newTool();
    t = addInput(t).tool;
    t = addInput(t).tool;
    expect(t.inputs.map((i) => i.name)).toEqual(["input", "input 2"]);
  });

  it("renaming an input keeps mappings and blocks pointing at it", () => {
    const t = updateInput(sampleTool(), "subscriberId", { name: "subId" });
    expect(t.inputs[0].name).toBe("subId");
    expect(t.calls.find((c) => c.id === "c-subscriber")!.mappings.subscriberId).toEqual({ input: "subId" });
    expect(t.blocks.find((x) => x.id === "b-input")!.inputName).toBe("subId");
  });

  it("switching to text drops the options; to a dropdown gives an empty list", () => {
    let t = updateInput(sampleTool(), "subscriberId", { kind: "dropdown", options: ["a", "b"] });
    expect(t.inputs[0].options).toEqual(["a", "b"]);
    t = updateInput(t, "subscriberId", { kind: "text" });
    expect(t.inputs[0].options).toBeUndefined();
    expect(updateInput(sampleTool(), "subscriberId", { kind: "dropdown" }).inputs[0].options).toEqual([]);
  });

  it("removing an input falls back to the other sources", () => {
    const t = sampleTool();
    t.calls = t.calls.map((c) => (c.id === "c-devices" ? { ...c, mappings: { subscriberId: { input: "subscriberId", fixed: "1" } } } : c));
    const out = removeInput(t, "subscriberId");
    expect(out.inputs).toEqual([]);
    expect(out.calls.find((c) => c.id === "c-devices")!.mappings.subscriberId).toEqual({ fixed: "1" });
    expect(out.calls.find((c) => c.id === "c-subscriber")!.mappings).toEqual({});
    expect(out.blocks.find((x) => x.id === "b-input")!.inputName).toBeUndefined();
  });

  it("reads dropdown options from lines or commas", () => {
    expect(parseOptions("a, b\nc,, a")).toEqual(["a", "b", "c"]);
  });
});

describe("paths from a sample response", () => {
  const sample = {
    id: 7,
    name: "Ada",
    "first name": "A",
    "weird]key": 1,
    autoPay: true,
    nested: { deep: { value: "x" } },
    items: [{ number: "INV-1", amount: 40 }, { number: "INV-2", amount: 41 }, { number: "INV-3", amount: 42 }, { number: "INV-4", amount: 43 }],
    nothing: null,
  };

  it("builds paths that readPath reads back", () => {
    const seen: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      seen.push(n);
      n.children.forEach(walk);
    };
    walk(buildTree(sample));
    expect(seen.length).toBeGreaterThan(15);
    for (const n of seen.filter((x) => x.pickable && x.kind !== "object" && x.kind !== "array")) {
      const v = readPath(sample, n.path);
      expect(v === undefined ? null : v).toEqual(n.kind === "null" ? null : JSON.parse(n.kind === "string" ? JSON.stringify(v) : String(v)));
    }
    const byPath = new Map(seen.map((n) => [n.path, n]));
    expect(byPath.get("$.nested.deep.value")?.preview).toBe('"x"');
    expect(byPath.get('$["first name"]')?.kind).toBe("string");
    expect(byPath.get("$.items[2].amount")?.preview).toBe("42");
    expect(byPath.has("$.items[3]")).toBe(false);
    expect(byPath.get("$.items")?.total).toBe(4);
  });

  it("marks keys that cannot be written as a path as not pickable", () => {
    const node = buildTree(sample).children.find((n) => n.key === "weird]key")!;
    expect(node.pickable).toBe(false);
  });

  it("quotes keys the right way", () => {
    expect(childPath("$", "a")).toBe("$.a");
    expect(childPath("$.a", 0)).toBe("$.a[0]");
    expect(childPath("$", "a b")).toBe('$["a b"]');
    expect(childPath("$", 'say "hi"')).toBe("$['say \"hi\"']");
    expect(readPath({ 'say "hi"': 1 }, childPath("$", 'say "hi"'))).toBe(1);
  });

  it("builds a tree of a bare list or value", () => {
    const t = buildTree([{ a: 1 }]);
    expect(t.path).toBe("$");
    expect(t.children[0].path).toBe("$[0]");
    expect(t.children[0].children[0].path).toBe("$[0].a");
    expect(buildTree("x").children).toEqual([]);
  });

  it("finds lists for table and pick-a-row settings", () => {
    expect(listPathOptions([1])).toEqual(["$"]);
    expect(listPathOptions({ data: { rows: [1] }, items: [2], name: "x" })).toEqual(["$.data.rows", "$.items"]);
    expect(listPathOptions("text")).toEqual([]);
    expect(guessLabelPath({ id: 1, name: "Pixel" })).toBe("$.name");
    expect(guessLabelPath({ id: 1, code: "z" })).toBe("$.id");
    expect(guessLabelPath({ n: 1, other: "z" })).toBe("$.other");
    expect(guessLabelPath(5)).toBe("");
  });

  it("makes labels and formats from the path and value", () => {
    expect(humanize("autoPay")).toBe("Auto pay");
    expect(humanize("account_id")).toBe("Account id");
    expect(labelForPath("$.account.planId")).toBe("Plan id");
    expect(labelForPath("$.items[0]")).toBe("Items");
    expect(labelForPath("$")).toBe("$");
    expect(guessFormat(true, "$.autoPay")).toBe("yes-no");
    expect(guessFormat(40, "$.monthlyFee")).toBe("money");
    expect(guessFormat(3, "$.count")).toBe("number");
    expect(guessFormat("2021-03-14", "$.joined")).toBe("date");
    expect(guessFormat("x", "$.name")).toBe("text");
  });
});

describe("picking fields by clicking", () => {
  const sample = { name: "Ada", autoPay: true, balance: 12, status: "active" };

  it("fields and table add and remove", () => {
    let blk = newBlock("fields", 0);
    blk = togglePath(blk, "$.name", sample);
    blk = togglePath(blk, "$.autoPay", sample);
    blk = togglePath(blk, "$.balance", sample);
    expect(blk.fields).toEqual([
      { path: "$.name", label: "Name", format: "text" },
      { path: "$.autoPay", label: "Auto pay", format: "yes-no" },
      { path: "$.balance", label: "Balance", format: "money" },
    ]);
    expect(isPicked(blk, "$.name")).toBe(true);
    blk = togglePath(blk, "$.name", sample);
    expect(blk.fields.map((f) => f.path)).toEqual(["$.autoPay", "$.balance"]);
    expect(isPicked(blk, "$.name")).toBe(false);
  });

  it("number, status and json use one field", () => {
    for (const type of ["number", "status"] as const) {
      let blk = newBlock(type, 0);
      blk = togglePath(blk, "$.name", sample);
      blk = togglePath(blk, "$.balance", sample);
      expect(blk.fields.map((f) => f.path)).toEqual(["$.balance"]);
      blk = togglePath(blk, "$.balance", sample);
      expect(blk.fields).toEqual([]);
    }
  });

  it("json: the root means the whole response (no field)", () => {
    let blk = newBlock("json", 0);
    expect(isPicked(blk, "$")).toBe(true);
    blk = togglePath(blk, "$.name", sample);
    expect(blk.fields).toEqual([{ path: "$.name", label: "Name", format: "text" }]);
    expect(isPicked(blk, "$")).toBe(false);
    expect(togglePath(blk, "$", sample).fields).toEqual([]);
    expect(togglePath(blk, "$.name", sample).fields).toEqual([]);
  });

  it("adds a typed path once, ignoring blanks", () => {
    let blk = newBlock("fields", 0);
    blk = addFieldByPath(blk, "  $.name ", sample);
    expect(blk.fields).toHaveLength(1);
    expect(addFieldByPath(blk, "$.name", sample)).toBe(blk);
    expect(addFieldByPath(blk, "  ", sample)).toBe(blk);
  });

  it("edits, removes and reorders fields", () => {
    let blk = newBlock("fields", 0, {
      fields: [
        { path: "$.a", label: "A", format: "text" },
        { path: "$.b", label: "B", format: "text" },
        { path: "$.c", label: "C", format: "text" },
      ],
    });
    blk = updateField(blk, 1, { label: "Bee", format: "money" });
    expect(blk.fields[1]).toEqual({ path: "$.b", label: "Bee", format: "money" });
    expect(moveField(blk, 2, 0).fields.map((f) => f.path)).toEqual(["$.c", "$.a", "$.b"]);
    expect(moveField(blk, 0, 99).fields.map((f) => f.path)).toEqual(["$.b", "$.c", "$.a"]);
    expect(moveField(blk, 1, 1)).toBe(blk);
    expect(removeField(blk, 0).fields.map((f) => f.path)).toEqual(["$.b", "$.c"]);
  });

  it("reads table columns from a row, other blocks from the response", () => {
    const call = newCall("r", "Invoices");
    const result = done({ invoices: [{ number: "INV-1" }, { number: "INV-2" }] });
    const table = newBlock("table", 0, { callId: call.id });
    expect(blockSample(table, call, result)).toEqual({ number: "INV-1" });
    expect(blockSample(newBlock("fields", 0), call, result)).toEqual({ invoices: [{ number: "INV-1" }, { number: "INV-2" }] });
    expect(blockSample(table, call, undefined)).toBeUndefined();
    expect(blockSample(table, undefined, result)).toBeUndefined();
    const pick = { ...call, pickRow: { listPath: "$.invoices", labelPath: "$.number" } };
    expect(blockSample(newBlock("fields", 0), pick, result)).toEqual({ number: "INV-1" });
  });
});

describe("status colours", () => {
  it("writes the value = colour lines that parseColourMap reads", () => {
    const text = colourMapText([
      { value: "Active", colour: "green" },
      { value: " Suspended ", colour: "red" },
      { value: "", colour: "blue" },
      { value: "a=b", colour: "blue" },
    ]);
    expect(text).toBe("Active = green\nSuspended = red");
    expect(parseColourMap(text)).toEqual({ active: "green", suspended: "red" });
  });

  it("reads lines back in order, with the case typed", () => {
    expect(colourEntries("Active = green\nbogus\nx = purple\nOn hold = amber")).toEqual([
      { value: "Active", colour: "green" },
      { value: "On hold", colour: "amber" },
    ]);
    expect(colourEntries(undefined)).toEqual([]);
  });
});

describe("the draft", () => {
  it("is dirty only when it differs from the saved tool", () => {
    const saved = sampleTool();
    expect(isDirty(saved, undefined)).toBe(false);
    expect(isDirty(saved, sampleTool())).toBe(false);
    expect(isDirty(saved, { ...sampleTool(), name: "Other" })).toBe(true);
    // Editing and undoing is not a change.
    const edited = updateInput(sampleTool(), "subscriberId", { default: "1" });
    expect(isDirty(saved, edited)).toBe(true);
    expect(isDirty(saved, updateInput(edited, "subscriberId", { default: "100234" }))).toBe(false);
  });

  it("refuses to save a loop but allows a missing request", () => {
    const t = sampleTool();
    t.calls = t.calls.map((c) => (c.id === "c-plan" ? { ...c, requestId: "gone" } : c));
    expect(saveBlockers(t, find)).toEqual([]);
    t.calls = t.calls.map((c) => (c.id === "c-account" ? { ...c, mappings: { accountId: { call: { callId: "c-account", path: "$.id" } } } } : c));
    const blockers = saveBlockers(t, find);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toMatch(/needs its own result/);
  });

  it("two inputs with one name block saving", () => {
    const t = newTool();
    t.inputs = [
      { name: "a", label: "A", kind: "text" },
      { name: "a", label: "A2", kind: "text" },
    ];
    expect(saveBlockers(t, find).map((p) => p.code)).toEqual(["duplicate-input"]);
  });
});
