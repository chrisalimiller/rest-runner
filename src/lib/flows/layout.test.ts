import { describe, expect, it } from "vitest";
import { COLUMN_GAP, nodeSize, ROW_GAP, tidyFlow, tidyLayout } from "./layout";
import { newEdge, newFlow, newNode } from "./flows";
import type { Flow, FlowNode } from "./types";

const at = (n: FlowNode, x: number, y: number): FlowNode => ({ ...n, position: { x, y } });

/** Start → A; A passed → B, A failed → C; B → D; C → D. All dumped at the origin. */
function diamond(): { flow: Flow; ids: Record<string, string> } {
  const f = newFlow("D");
  const start = f.nodes[0];
  const [a, b, c, d] = ["a", "b", "c", "d"].map(() => at(newNode("run-request"), 0, 0));
  const flow: Flow = {
    ...f,
    nodes: [at(start, 100, 100), a, b, c, d],
    edges: [newEdge(start.id, "next", a.id), newEdge(a.id, "failed", c.id), newEdge(a.id, "passed", b.id), newEdge(b.id, "passed", d.id), newEdge(c.id, "passed", d.id)],
  };
  return { flow, ids: { start: start.id, a: a.id, b: b.id, c: c.id, d: d.id } };
}

describe("tidyLayout", () => {
  it("puts steps left to right with the set gaps", () => {
    const { flow, ids } = diamond();
    const pos = tidyLayout(flow);
    const w = nodeSize(flow.nodes[1]).width;
    expect(pos.get(ids.a)!.x - pos.get(ids.start)!.x).toBe(nodeSize(flow.nodes[0]).width + COLUMN_GAP);
    expect(pos.get(ids.b)!.x).toBe(pos.get(ids.a)!.x + w + COLUMN_GAP);
    expect(pos.get(ids.d)!.x).toBe(pos.get(ids.b)!.x + w + COLUMN_GAP);
  });

  it("leaves no overlaps and the row gap between steps in a column", () => {
    const { flow } = diamond();
    const pos = tidyLayout(flow);
    const boxes = flow.nodes.map((n) => ({ ...pos.get(n.id)!, ...nodeSize(n) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
    const [b, c] = [pos.get(flow.nodes[2].id)!, pos.get(flow.nodes[3].id)!];
    expect(Math.abs(c.y - b.y)).toBeGreaterThanOrEqual(nodeSize(flow.nodes[2]).height + ROW_GAP);
  });

  it("orders rows by the order of the wires, whatever order they were drawn in", () => {
    const { flow, ids } = diamond();
    const pos = tidyLayout(flow);
    // A's passed wire (to B) sits above its failed wire (to C), though the failed wire was added first.
    expect(pos.get(ids.b)!.y).toBeLessThan(pos.get(ids.c)!.y);
  });

  it("keeps Start where it was", () => {
    const { flow, ids } = diamond();
    expect(tidyLayout(flow).get(ids.start)).toEqual({ x: 100, y: 100 });
  });

  it("moves a sticky note with the step it sat next to", () => {
    const { flow: d, ids } = diamond();
    const flow = { ...d, nodes: d.nodes.map((n) => (n.id === ids.start ? n : at(n, 2000, 2000))) };
    const note = at({ ...newNode("note"), type: "note", text: "hi", width: 160, height: 80 } as FlowNode, 20, -60);
    const withNote = { ...flow, nodes: [...flow.nodes, note] };
    const pos = tidyLayout(withNote);
    // The note was above-left of Start, so it stays at the same offset from Start.
    expect(pos.get(note.id)).toEqual({ x: pos.get(ids.start)!.x + (20 - 100), y: pos.get(ids.start)!.y + (-60 - 100) });
  });

  it("copes with an empty flow, loose steps and wires into a loop", () => {
    expect(tidyLayout({ ...newFlow("E"), nodes: [], edges: [] }).size).toBe(0);
    const f = newFlow("L");
    const loop = at(newNode("loop"), 0, 0);
    const body = at(newNode("run-request"), 0, 0);
    const loose = at(newNode("wait"), 0, 0);
    const flow: Flow = { ...f, nodes: [...f.nodes, loop, body, loose], edges: [newEdge(f.nodes[0].id, "next", loop.id), newEdge(loop.id, "row", body.id), newEdge(body.id, "passed", loop.id)] };
    const moved = tidyFlow(flow);
    expect(moved.nodes).toHaveLength(4);
    expect(moved.nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);
  });
});
