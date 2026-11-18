import { describe, expect, it } from "vitest";
import type { Flow, FlowNode } from "./types";
import { flowsUsing, flowsUsingSuiteOrItsCases, usedByLabel } from "./usedBy";

const retry = { max: 0, delayMs: 0 } as never;
const node = (n: Record<string, unknown>) => ({ x: 0, y: 0, label: "", ...n }) as unknown as FlowNode;
const flow = (id: string, name: string, nodes: FlowNode[]): Flow => ({ id, name, description: "", nodes, edges: [] });

const flows: Flow[] = [
  flow("f1", "Login then data", [node({ id: "a", type: "start" }), node({ id: "b", type: "run-suite", suiteId: "s1", retry }), node({ id: "c", type: "run-suite", suiteId: "s1", retry })]),
  flow("f2", "Nightly", [node({ id: "d", type: "run-case", suiteId: "s1", caseId: "c1", retry }), node({ id: "e", type: "run-case", suiteId: "s2", caseId: "c9", retry })]),
  flow("f3", "Other", [node({ id: "g", type: "run-suite", suiteId: "s2", retry })]),
];

describe("flowsUsing", () => {
  it("finds flows with a Run suite step, once per flow, with the first step", () => {
    expect(flowsUsing(flows, "s1")).toEqual([{ flowId: "f1", flowName: "Login then data", nodeId: "b" }]);
  });
  it("finds flows with a Run case step for that case only", () => {
    expect(flowsUsing(flows, "s1", "c1")).toEqual([{ flowId: "f2", flowName: "Nightly", nodeId: "d" }]);
    expect(flowsUsing(flows, "s1", "other")).toEqual([]);
  });
  it("returns nothing when no flow uses it", () => {
    expect(flowsUsing(flows, "nope")).toEqual([]);
  });
});

describe("flowsUsingSuiteOrItsCases", () => {
  it("counts both Run suite and Run case steps", () => {
    expect(flowsUsingSuiteOrItsCases(flows, "s1").map((u) => u.flowId)).toEqual(["f1", "f2"]);
  });
});

describe("usedByLabel", () => {
  it("names one flow, counts several, and is empty for none", () => {
    expect(usedByLabel(flowsUsing(flows, "s1"))).toBe("Used by Login then data");
    expect(usedByLabel(flowsUsingSuiteOrItsCases(flows, "s1"))).toBe("Used by 2 flows");
    expect(usedByLabel([])).toBe("");
  });
});
