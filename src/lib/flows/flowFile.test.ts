import { describe, expect, it } from "vitest";
import { newCollection, newFolder, requestNode, type Collection, type RequestNode } from "../collections";
import { newRequest } from "../defaults";
import { newSuite } from "../testing/suites";
import { describeImport, importFlowsFile, itemsUsedBy, toFlowsFile } from "./flowFile";
import { newEdge, newFlow, newNode } from "./flows";
import type { Flow, FlowNode } from "./types";

function setup() {
  const used = { ...newSuite("Used suite") };
  const unused = { ...newSuite("Other suite") };
  const req = { ...newRequest(), id: "req-1", name: "Health" };
  const other = { ...newRequest(), id: "req-2", name: "Unused" };
  const c = newCollection("API");
  const folder = newFolder("Checks");
  folder.items = [requestNode(req), requestNode(other)];
  c.items = [folder];
  const flow = newFlow("Smoke");
  const runSuite = { ...newNode("run-suite"), suiteId: used.id } as FlowNode;
  const runReq = { ...newNode("run-request"), requestId: req.id } as FlowNode;
  const withSteps: Flow = { ...flow, nodes: [...flow.nodes, runSuite, runReq], edges: [newEdge(flow.nodes[0].id, "next", runSuite.id), newEdge(runSuite.id, "passed", runReq.id)] };
  return { suites: [used, unused], collections: [c], flow: withSteps, req };
}

describe("flows file", () => {
  it("carries only the suites and saved requests the flows run, with where each request sat", () => {
    const { suites, collections, flow } = setup();
    const used = itemsUsedBy([flow], suites, collections);
    expect(used.suites.map((s) => s.name)).toEqual(["Used suite"]);
    expect(used.requests).toHaveLength(1);
    expect(used.requests[0]).toMatchObject({ collectionName: "API", folderPath: ["Checks"] });
    expect(used.requests[0].node.request.name).toBe("Health");
  });

  it("imports into an empty app, putting requests back in the same collection and folder", () => {
    const { suites, collections, flow } = setup();
    const text = toFlowsFile([flow], suites, collections);
    const result = importFlowsFile(text, { flows: [], suites: [], collections: [] });
    expect(result.flows.map((f) => f.name)).toEqual(["Smoke"]);
    expect(result.suites.map((s) => s.name)).toEqual(["Used suite"]);
    expect(result.collections[0].name).toBe("API");
    const folder = result.collections[0].items[0];
    expect(folder.kind === "folder" && folder.name).toBe("Checks");
    expect(folder.kind === "folder" && (folder.items[0] as RequestNode).id).toBe("req-1");
    expect(describeImport("flows.json", result.counts)).toBe("Imported flows.json: flows: 1 added, 0 updated; suites: 1 added, 0 updated; saved requests: 1 added, 0 updated.");
  });

  it("replaces items with the same id instead of adding copies", () => {
    const { suites, collections, flow, req } = setup();
    const renamed: Collection[] = structuredClone(collections);
    const node = (renamed[0].items[0] as { items: RequestNode[] }).items[0];
    node.request = { ...node.request, name: "Health v2" };
    const text = toFlowsFile([{ ...flow, name: "Smoke v2" }], suites, renamed);
    const result = importFlowsFile(text, { flows: [flow], suites, collections });
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0].name).toBe("Smoke v2");
    expect(result.suites).toHaveLength(2);
    const items = (result.collections[0].items[0] as { items: RequestNode[] }).items;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === req.id)?.request.name).toBe("Health v2");
    expect(result.counts).toEqual({ flows: [0, 1], suites: [0, 1], requests: [0, 1] });
  });

  it("rejects files that are not flows files", () => {
    expect(() => importFlowsFile("nope", { flows: [], suites: [], collections: [] })).toThrow(/not valid JSON/);
    expect(() => importFlowsFile('{"app":"rest-runner","kind":"suites"}', { flows: [], suites: [], collections: [] })).toThrow(/not a REST Runner flows file/);
  });
});
