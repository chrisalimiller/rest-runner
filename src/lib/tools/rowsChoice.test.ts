import { describe, expect, it } from "vitest";
import { toToolsFile, importToolsFile } from "./toolsFile";
import { cleanTools, newBlock, newCall, newTool } from "./tools";
import type { BlockField, CallResult, Tool } from "./types";
import { fieldRows } from "./view";

const items = [
  { name: "Roaming", id: 1, features: ["a", "b"], extra: { x: 1 } },
  { name: "Voicemail", id: 2, features: [] },
  { name: "Data", id: 3 },
  { name: "SMS", id: 4 },
  { name: "Calls", id: 5 },
  { name: "Fax", id: 6 },
  { name: "Cloud", id: 7 },
];

function done(body: unknown): CallResult {
  const text = JSON.stringify(body);
  return { callId: "c1", name: "c1", state: "done", status: 200, response: { status: 200, statusText: "", headers: [], body: text, sizeBytes: text.length, durationMs: 1 } };
}

function toolWith(field: BlockField): Tool {
  const call = { ...newCall("r1", "Subscriber"), id: "c1", lists: [{ id: "L", name: "Serv items", path: "$.servItems", labelPath: "$.name", choose: { kind: "none" as const } }] };
  return { ...newTool("T"), id: "t", calls: [call], blocks: [newBlock("fields", 0, { id: "b", callId: "c1", fields: [field] })] };
}

const rowsField: BlockField = {
  path: "$",
  label: "Service items",
  format: "text",
  list: {
    listId: "L",
    item: { kind: "rows", columns: [{ path: "$.name", label: "Name", format: "text" }, { path: "$.id", label: "Id", format: "number" }, { path: "features", label: "Features", format: "text" }, { path: "$.missing", label: "Gone", format: "text" }], max: 3 },
  },
};

describe("a list shown as rows", () => {
  it("builds columns and rows, with a dash for a missing key and N items for a list in a cell", () => {
    const t = toolWith(rowsField);
    const [row] = fieldRows(t.blocks[0], t.calls[0], done({ servItems: items }));
    expect(row.label).toBe("Service items");
    expect(row.value).toBe("7 items");
    expect(row.table?.columns).toEqual(["Name", "Id", "Features", "Gone"]);
    expect(row.table?.rows).toHaveLength(7);
    expect(row.table?.max).toBe(3);
    expect(row.table?.rows[0]).toEqual(["Roaming", "1", "2 items", "—"]);
    expect(row.table?.rows[2]).toEqual(["Data", "3", "—", "—"]);
  });

  it("uses a filter, says so for an empty list, and reads dashes before the lookup is done", () => {
    const where = { field: "$.id", op: "ne" as const, value: { fixed: "1" } };
    const filtered = toolWith({ ...rowsField, list: { listId: "L", item: { kind: "rows", columns: [{ path: "$.name", label: "", format: "text" }], where } } });
    const [a] = fieldRows(filtered.blocks[0], filtered.calls[0], done({ servItems: items }));
    expect(a.table?.rows).toHaveLength(6);
    expect(a.table?.columns).toEqual(["name"]);
    expect(a.table?.max).toBe(5);
    const t = toolWith(rowsField);
    expect(fieldRows(t.blocks[0], t.calls[0], done({ servItems: [] }))[0]).toEqual({ label: "Service items", value: "No items" });
    expect(fieldRows(t.blocks[0], t.calls[0], undefined)[0].value).toBe("—");
  });

  it("shows plain values in one Value column", () => {
    const t = toolWith({ ...rowsField, list: { listId: "L", item: { kind: "rows", columns: [{ path: "$", label: "Value", format: "text" }] } } });
    const [row] = fieldRows(t.blocks[0], t.calls[0], done({ servItems: ["CID", "VM"] }));
    expect(row.table?.rows).toEqual([["CID"], ["VM"]]);
  });
});

describe("a saved plain field that holds a list (display only)", () => {
  it("draws records as a table with the first three plain keys, and plain values joined", () => {
    const t = toolWith({ path: "$.servItems", label: "Items", format: "text" });
    const [row] = fieldRows(t.blocks[0], t.calls[0], done({ servItems: items }));
    expect(row.table?.columns).toEqual(["name", "id"]);
    expect(row.table?.rows).toHaveLength(7);
    const [tags] = fieldRows(t.blocks[0], t.calls[0], done({ servItems: ["CID", "VM"] }));
    expect(tags).toEqual({ label: "Items", value: "CID, VM" });
  });

  it("leaves other values alone", () => {
    const t = toolWith({ path: "$.name", label: "Name", format: "text" });
    expect(fieldRows(t.blocks[0], t.calls[0], done({ name: "Ada" }))[0]).toEqual({ label: "Name", value: "Ada" });
  });

  it("loads and saves a tool with the plain field unchanged", () => {
    const t = toolWith({ path: "$.servItems", label: "Items", format: "text" });
    const before = JSON.stringify(t);
    expect(cleanTools([JSON.parse(before)])[0]).toEqual(t);
    const file = JSON.parse(toToolsFile([t], []));
    expect(file.version).toBe(2);
    expect(importToolsFile(JSON.stringify(file), { tools: [], collections: [] }).tools[0]).toEqual(t);
  });
});

describe("rows in saved tools", () => {
  it("round-trips through cleanTools and makes a version 3 file only when used", () => {
    const t = toolWith(rowsField);
    expect(cleanTools(JSON.parse(JSON.stringify([t])))).toEqual([t]);
    expect(JSON.parse(toToolsFile([t], [])).version).toBe(3);
    const back = importToolsFile(toToolsFile([t], []), { tools: [], collections: [] });
    expect(back.tools).toEqual([t]);
    const plain = { ...toolWith({ path: "$.name", label: "N", format: "text" }) };
    plain.calls = [{ ...plain.calls[0], lists: undefined }];
    expect(JSON.parse(toToolsFile([plain], [])).version).toBe(1);
  });

  it("keeps rows only on a field of a Fields block, and drops one with no columns", () => {
    const t = toolWith(rowsField);
    const onTable = { ...t, blocks: [{ ...t.blocks[0], type: "table" as const }] };
    const cleaned = cleanTools(JSON.parse(JSON.stringify([onTable])))[0];
    expect(cleaned.blocks[0].fields[0].list).toEqual({ listId: "L" });
    const noCols = toolWith({ ...rowsField, list: { listId: "L", item: { kind: "rows", columns: [] } } });
    expect(cleanTools(JSON.parse(JSON.stringify([noCols])))[0].blocks[0].fields[0].list).toEqual({ listId: "L" });
  });

  it("fixes the table's row cap between 1 and 100", () => {
    const t = toolWith({ ...rowsField, list: { listId: "L", item: { kind: "rows", columns: [{ path: "$.name", label: "N", format: "text" }], max: 5000 } } });
    const cleaned = cleanTools(JSON.parse(JSON.stringify([t])))[0].blocks[0].fields[0].list?.item;
    expect(cleaned).toMatchObject({ kind: "rows", max: 100 });
  });
});
