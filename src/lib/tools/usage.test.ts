import { describe, expect, it } from "vitest";
import { newCollection, newFolder, requestNode, type TreeNode } from "../collections";
import { newRequest } from "../defaults";
import { newCall, newTool } from "./tools";
import { deleteWarning, idsRemovedBy, requestIdsIn, toolsUsingRequests, usedByLabel } from "./usage";

const tool = (name: string, ...requestIds: string[]) => ({ ...newTool(name), calls: requestIds.map((r, i) => newCall(r, `Call ${i}`)) });

describe("toolsUsingRequests", () => {
  it("finds tools with a call to the request, once each, even when it appears twice", () => {
    const a = tool("A", "r1", "r1");
    const b = tool("B", "r2");
    const c = tool("C", "r1");
    expect(toolsUsingRequests([a, b, c], ["r1"]).map((t) => t.name)).toEqual(["A", "C"]);
  });
  it("is empty for no ids or no match", () => {
    expect(toolsUsingRequests([tool("A", "r1")], [])).toEqual([]);
    expect(toolsUsingRequests([tool("A", "r1")], ["zzz"])).toEqual([]);
  });
});

describe("requestIdsIn", () => {
  it("collects requests and examples, through folders", () => {
    const req = (id: string, ex: string[]): TreeNode => ({ kind: "request", id, request: { id } as never, examples: ex.map((e) => ({ id: e }) as never) });
    const nodes: TreeNode[] = [req("a", ["a1"]), { kind: "folder", id: "f", name: "F", items: [req("b", [])] }];
    expect(requestIdsIn(nodes)).toEqual(["a", "a1", "b"]);
  });
});

describe("idsRemovedBy", () => {
  it("covers a request with its examples, an example alone, a folder and a collection", () => {
    const c = newCollection("C");
    const folder = newFolder("F");
    const r = requestNode({ ...newRequest(), id: "r1" });
    r.examples = [{ id: "e1" } as never];
    folder.items = [r];
    c.items = [folder];
    expect(idsRemovedBy([c], "r1")).toEqual(["r1", "e1"]);
    expect(idsRemovedBy([c], "e1")).toEqual(["e1"]);
    expect(idsRemovedBy([c], folder.id)).toEqual(["r1", "e1"]);
    expect(idsRemovedBy([c], c.id)).toEqual(["r1", "e1"]);
    expect(idsRemovedBy([c], "nope")).toEqual([]);
  });
});

describe("labels", () => {
  it("pluralises", () => {
    expect(usedByLabel(0)).toBe("");
    expect(usedByLabel(1)).toBe("Used by 1 tool");
    expect(usedByLabel(2)).toBe("Used by 2 tools");
  });
  it("lists the tools in the warning, shortening long lists", () => {
    expect(deleteWarning('The request "Get"', [{ name: "A" }])).toContain('the tool "A"');
    const w = deleteWarning("It", ["A", "B", "C", "D", "E"].map((name) => ({ name })));
    expect(w).toContain('"A", "B", "C" and 2 more');
  });
});
