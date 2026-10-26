import { describe, expect, it } from "vitest";
import { activeEdgeIds, loopProgress, runningLine } from "./progress";
import { newEdge, newFlow, newNode } from "./flows";
import type { Flow, FlowStep } from "./types";

function step(nodeId: string, p: Partial<FlowStep> = {}): FlowStep {
  return { index: 0, nodeId, nodeType: "wait", label: "", status: "passed", startedAt: "", durationMs: 0, varsBefore: {}, varsAfter: {}, notes: [], ...p };
}

function loopFlow(): { flow: Flow; loop: string; body: string; after: string } {
  const flow = newFlow();
  const loop = { ...newNode("loop"), data: { name: "a.csv", text: "id\n1\n2\n3\n" } } as Flow["nodes"][number];
  const body = newNode("wait");
  const after = newNode("wait");
  return {
    flow: {
      ...flow,
      nodes: [...flow.nodes, loop, body, after],
      edges: [newEdge(flow.nodes[0].id, "next", loop.id), newEdge(loop.id, "row", body.id), newEdge(loop.id, "done", after.id)],
    },
    loop: loop.id,
    body: body.id,
    after: after.id,
  };
}

describe("loopProgress", () => {
  it("reports the row after the latest finished step in the loop body", () => {
    const { flow, body } = loopFlow();
    expect(loopProgress(flow, [], [body])).toEqual({ row: 1, total: 3 });
    expect(loopProgress(flow, [step(body, { row: 0 }), step(body, { row: 1 })], [body])).toEqual({ row: 2, total: 3 });
  });

  it("is null outside a loop or with nothing running", () => {
    const { flow, after, body } = loopFlow();
    expect(loopProgress(flow, [], [after])).toBeNull();
    expect(loopProgress(flow, [], [])).toBeNull();
    expect(loopProgress(newFlow(), [], [body])).toBeNull();
  });
});

describe("activeEdgeIds", () => {
  it("picks wires taken into a step that is running now", () => {
    const { flow, loop, body } = loopFlow();
    const rowEdge = flow.edges.find((e) => e.source === loop && e.sourceHandle === "row")!;
    expect(activeEdgeIds(flow, [step(loop, { output: "row" })], [body])).toEqual(new Set([rowEdge.id]));
    expect(activeEdgeIds(flow, [], [body]).size).toBe(0);
  });
});

describe("runningLine", () => {
  it("joins the parts", () => {
    expect(runningLine({ row: 2, total: 3 }, 8100)).toBe("Running · Loop row 2 of 3 · 8.1 s");
    expect(runningLine(null, 65000)).toBe("Running · 1 m 5 s");
  });
});
