import { parseCsv } from "../csv";
import type { Flow, FlowStep } from "./types";

/** Every node a wire path leads to from a node, not counting the node itself unless a loop leads back to it. */
function reachableFrom(flow: Flow, startIds: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of flow.edges) if (e.source === id) queue.push(e.target);
  }
  return seen;
}

export interface LoopProgress {
  /** 1-based number of the row being run. */
  row: number;
  total: number;
}

/**
 * Where the flow is in a Loop over CSV right now, or null when no running step is inside one.
 * With loops inside loops, the innermost one is reported. The row is the latest one a finished
 * step inside the loop ran for, since steps are only recorded when they finish.
 */
export function loopProgress(flow: Flow, steps: FlowStep[], runningNodeIds: string[]): LoopProgress | null {
  if (runningNodeIds.length === 0) return null;
  let best: { loopId: string; body: Set<string>; total: number } | null = null;
  for (const node of flow.nodes) {
    if (node.type !== "loop") continue;
    const first = flow.edges.filter((e) => e.source === node.id && e.sourceHandle === "row").map((e) => e.target);
    const body = reachableFrom(flow, first);
    body.delete(node.id);
    if (!runningNodeIds.some((id) => body.has(id))) continue;
    if (!best || body.size < best.body.size) best = { loopId: node.id, body, total: node.data ? parseCsv(node.data.text).rows.length : 0 };
  }
  if (!best || best.total === 0) return null;
  let row = 0;
  for (const s of steps) if (s.row !== undefined && best.body.has(s.nodeId)) row = Math.max(row, s.row + 1);
  return { row: Math.min(Math.max(row, 1), best.total), total: best.total };
}

/** Edges the run just took into a step that is running now: these animate on the canvas. */
export function activeEdgeIds(flow: Flow, steps: FlowStep[], runningNodeIds: string[]): Set<string> {
  const running = new Set(runningNodeIds);
  const taken = new Set(steps.filter((s) => s.output !== undefined).map((s) => `${s.nodeId}:${s.output}`));
  return new Set(flow.edges.filter((e) => running.has(e.target) && taken.has(`${e.source}:${e.sourceHandle}`)).map((e) => e.id));
}

function clock(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

/** "Running · Loop row 2 of 3 · 8.1 s" */
export function runningLine(loop: LoopProgress | null, elapsedMs: number): string {
  return ["Running", loop ? `Loop row ${loop.row} of ${loop.total}` : null, clock(elapsedMs)].filter(Boolean).join(" · ");
}
