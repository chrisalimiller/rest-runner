import { describe, expect, it } from "vitest";
import { newCollection, newFolder, requestNode, type Collection, type RequestNode } from "../collections";
import { newRequest } from "../defaults";
import { describeToolsImport, importToolsFile, requestsUsedBy, toToolsFile } from "./toolsFile";
import { newCall, newTool } from "./tools";

function setup() {
  const req = { ...newRequest(), id: "req-1", name: "Subscriber" };
  const other = { ...newRequest(), id: "req-2", name: "Unused" };
  const c = newCollection("API");
  const folder = newFolder("Lookups");
  folder.items = [requestNode(req), requestNode(other)];
  c.items = [folder];
  const tool = { ...newTool("Subscriber 360"), calls: [newCall("req-1", "Subscriber"), newCall("req-1", "Subscriber again"), newCall("gone", "Missing")] };
  return { collections: [c], tool, req };
}

describe("tools file", () => {
  it("carries only the saved requests the tools call, once each, with where they sat", () => {
    const { collections, tool } = setup();
    const used = requestsUsedBy([tool], collections);
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ collectionName: "API", folderPath: ["Lookups"] });
  });

  it("imports into an empty app and puts requests back in the same collection and folder", () => {
    const { collections, tool } = setup();
    const r = importToolsFile(toToolsFile([tool], collections), { tools: [], collections: [] });
    expect(r.tools.map((t) => t.name)).toEqual(["Subscriber 360"]);
    expect(r.replacedIds).toEqual([]);
    const folder = r.collections[0].items[0];
    expect(folder.kind === "folder" && (folder.items[0] as RequestNode).id).toBe("req-1");
    expect(describeToolsImport("t.json", r.counts)).toBe("Imported t.json: tools: 1 added, 0 updated; saved requests: 1 added, 0 updated.");
  });

  it("replaces a tool and a request with the same id, and reports which tools were replaced", () => {
    const { collections, tool } = setup();
    const text = toToolsFile([tool], collections);
    const edited: Collection[] = structuredClone(collections);
    const f = edited[0].items[0];
    if (f.kind === "folder") (f.items[0] as RequestNode).request.name = "Old name";
    const r = importToolsFile(text, { tools: [{ ...tool, name: "Old tool" }], collections: edited });
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0].name).toBe("Subscriber 360");
    expect(r.replacedIds).toEqual([tool.id]);
    expect(r.counts).toEqual({ tools: [0, 1], requests: [0, 1] });
    const g = r.collections[0].items[0];
    expect(g.kind === "folder" && (g.items[0] as RequestNode).request.name).toBe("Subscriber");
  });

  it("cleans the tools it imports", () => {
    const text = JSON.stringify({ app: "rest-runner", kind: "tools", version: 1, tools: [{ id: "t1", name: 5, calls: "nope", blocks: [{ id: "b", type: "nonsense" }] }, "junk"], requests: [] });
    const r = importToolsFile(text, { tools: [], collections: [] });
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0]).toMatchObject({ id: "t1", name: "Tool", calls: [], blocks: [], settings: { keepHistory: true } });
  });

  it("refuses other files and invalid JSON", () => {
    expect(() => importToolsFile("{", { tools: [], collections: [] })).toThrow(/not valid JSON/);
    expect(() => importToolsFile(JSON.stringify({ app: "rest-runner", kind: "flows" }), { tools: [], collections: [] })).toThrow(/tools file/);
  });
});
