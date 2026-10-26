import dagre from "@dagrejs/dagre";
import { NODE_OUTPUTS, type Flow, type FlowNode, type FlowPosition } from "./types";

/** Space between columns and between rows of steps when a flow is tidied. */
export const COLUMN_GAP = 80;
export const ROW_GAP = 40;
export const NODE_WIDTH = 220;

/** Card size before it has been measured: a fixed width, and a height that grows with its outputs. */
export function nodeSize(node: FlowNode): { width: number; height: number } {
  if (node.type === "note") return { width: node.width, height: node.height };
  return { width: NODE_WIDTH, height: 62 + 16 * NODE_OUTPUTS[node.type].length };
}

const centre = (p: FlowPosition, s: { width: number; height: number }) => ({ x: p.x + s.width / 2, y: p.y + s.height / 2 });

/**
 * Arranges the steps left to right, one column per step of distance from Start, with COLUMN_GAP between columns and
 * ROW_GAP between rows. The step that came first (Start) stays where it was, so the canvas doesn't jump. Within a column,
 * rows follow the order of the wires (passed above failed, true above false). Sticky notes keep their place relative
 * to the step they were closest to. `sizes` replaces the estimated card sizes with measured ones.
 */
export function tidyLayout(flow: Flow, sizes: Map<string, { width: number; height: number }> = new Map()): Map<string, FlowPosition> {
  const size = (n: FlowNode) => sizes.get(n.id) ?? nodeSize(n);
  const steps = flow.nodes.filter((n) => n.type !== "note");
  const notes = flow.nodes.filter((n) => n.type === "note");
  const out = new Map<string, FlowPosition>();
  if (steps.length === 0) return out;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: COLUMN_GAP, nodesep: ROW_GAP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of steps) g.setNode(n.id, size(n));

  // Edges go in by step order then output order, which is the order dagre keeps rows in.
  const order = new Map(steps.map((n, i) => [n.id, i]));
  const outputIndex = (e: Flow["edges"][number]) => {
    const source = flow.nodes.find((n) => n.id === e.source);
    return source ? NODE_OUTPUTS[source.type].indexOf(e.sourceHandle) : 0;
  };
  const edges = flow.edges
    .filter((e) => order.has(e.source) && order.has(e.target))
    .sort((a, b) => order.get(a.source)! - order.get(b.source)! || outputIndex(a) - outputIndex(b));
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  const placed = new Map<string, FlowPosition>();
  for (const n of steps) {
    const p = g.node(n.id);
    const s = size(n);
    placed.set(n.id, { x: p.x - s.width / 2, y: p.y - s.height / 2 });
  }

  // Keep the anchor step (Start, else the left-most) where it was.
  const anchor = steps.find((n) => n.type === "start") ?? [...steps].sort((a, b) => a.position.x - b.position.x)[0];
  const dx = anchor.position.x - placed.get(anchor.id)!.x;
  const dy = anchor.position.y - placed.get(anchor.id)!.y;
  for (const n of steps) {
    const p = placed.get(n.id)!;
    out.set(n.id, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
  }

  // A note follows the step it sat closest to.
  for (const note of notes) {
    const c = centre(note.position, size(note));
    let near = steps[0];
    let best = Infinity;
    for (const s of steps) {
      const d = Math.hypot(centre(s.position, size(s)).x - c.x, centre(s.position, size(s)).y - c.y);
      if (d < best) {
        best = d;
        near = s;
      }
    }
    const moved = out.get(near.id)!;
    out.set(note.id, { x: Math.round(moved.x + note.position.x - near.position.x), y: Math.round(moved.y + note.position.y - near.position.y) });
  }
  return out;
}

/** The flow with its steps and notes moved to the tidy layout. */
export function tidyFlow(flow: Flow, sizes?: Map<string, { width: number; height: number }>): Flow {
  const positions = tidyLayout(flow, sizes);
  return { ...flow, nodes: flow.nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })) };
}
