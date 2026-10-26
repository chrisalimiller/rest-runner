import { describe, expect, it } from "vitest";
import { addStepAfter, addStepFromPalette, canFollow, filterStepGroups, firstFreeOutput, newFlow, newNode, STEP_GROUPS } from "./flows";
import { FLOW_NODE_TYPES } from "./types";

describe("step groups", () => {
  it("lists every step type once", () => {
    expect(STEP_GROUPS.flatMap((g) => g.types).sort()).toEqual([...FLOW_NODE_TYPES].sort());
  });

  it("filters by name or group and drops empty groups", () => {
    expect(filterStepGroups("").length).toBe(4);
    expect(filterStepGroups("loop")).toEqual([{ label: "Logic", types: ["loop"] }]);
    expect(filterStepGroups("RUN").map((g) => g.label)).toEqual(["Run"]);
    expect(filterStepGroups("zzz")).toEqual([]);
  });
});

describe("addStepAfter", () => {
  it("places the step 260 px to the right and wires it from the output", () => {
    const flow = newFlow();
    const start = flow.nodes[0];
    const { flow: next, node } = addStepAfter(flow, start.id, "next", "run-request");
    expect(node!.position).toEqual({ x: start.position.x + 260, y: start.position.y });
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0]).toMatchObject({ source: start.id, sourceHandle: "next", target: node!.id });
  });

  it("stacks below when the spot is taken", () => {
    const flow = newFlow();
    const a = addStepAfter(flow, flow.nodes[0].id, "next", "wait");
    const b = addStepAfter(a.flow, flow.nodes[0].id, "next", "wait");
    expect(b.node!.position.x).toBe(a.node!.position.x);
    expect(b.node!.position.y).toBeGreaterThan(a.node!.position.y);
  });

  it("rewires a single-wire output but keeps every branch of a parallel", () => {
    const flow = newFlow();
    const a = addStepAfter(flow, flow.nodes[0].id, "next", "wait");
    const b = addStepAfter(a.flow, flow.nodes[0].id, "next", "wait");
    expect(b.flow.edges.map((e) => e.target)).toEqual([b.node!.id]);
    const par = newNode("parallel", { x: 0, y: 0 });
    let f = { ...flow, nodes: [...flow.nodes, par] };
    f = addStepAfter(f, par.id, "branches", "wait").flow;
    f = addStepAfter(f, par.id, "branches", "wait").flow;
    expect(f.edges.filter((e) => e.source === par.id)).toHaveLength(2);
  });

  it("does not wire steps that have no input, and ignores a missing step", () => {
    const flow = newFlow();
    expect(canFollow("note")).toBe(false);
    expect(addStepAfter(flow, flow.nodes[0].id, "next", "note").flow.edges).toEqual([]);
    expect(addStepAfter(flow, "nope", "next", "wait").node).toBeNull();
  });
});

describe("addStepFromPalette", () => {
  it("wires from the first free output of the selected step", () => {
    const flow = newFlow();
    const a = addStepAfter(flow, flow.nodes[0].id, "next", "run-suite");
    const suite = a.node!;
    const b = addStepFromPalette(a.flow, suite.id, "wait");
    expect(b.flow.edges.find((e) => e.target === b.node!.id)).toMatchObject({ source: suite.id, sourceHandle: "passed" });
    const c = addStepFromPalette(b.flow, suite.id, "wait");
    expect(c.flow.edges.find((e) => e.target === c.node!.id)).toMatchObject({ sourceHandle: "failed" });
    expect(firstFreeOutput(c.flow, suite.id)).toBeNull();
    const d = addStepFromPalette(c.flow, suite.id, "wait");
    expect(d.flow.edges).toHaveLength(c.flow.edges.length);
  });

  it("goes next to the last step when nothing is selected", () => {
    const flow = newFlow();
    const a = addStepFromPalette(flow, null, "run-request");
    expect(a.flow.edges).toHaveLength(1);
    const b = addStepFromPalette(a.flow, null, "wait");
    expect(b.flow.edges.find((e) => e.target === b.node!.id)?.source).toBe(a.node!.id);
    expect(b.node!.position.x).toBe(a.node!.position.x + 260);
  });
});
