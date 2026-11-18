import type { Flow } from "./types";

/** One flow that uses a suite or a case, and the first step in it that does. */
export interface FlowUse {
  flowId: string;
  flowName: string;
  nodeId: string;
}

/** Flows with a Run suite step for this suite (or, with `caseId`, a Run case step for that case). One entry per flow. */
export function flowsUsing(flows: Flow[], suiteId: string, caseId?: string): FlowUse[] {
  const out: FlowUse[] = [];
  for (const f of flows) {
    const node = f.nodes.find((n) => (caseId === undefined ? n.type === "run-suite" && n.suiteId === suiteId : n.type === "run-case" && n.suiteId === suiteId && n.caseId === caseId));
    if (node) out.push({ flowId: f.id, flowName: f.name || "(unnamed flow)", nodeId: node.id });
  }
  return out;
}

/** Flows that would be affected by deleting a suite: any step that runs the suite or one of its cases. */
export function flowsUsingSuiteOrItsCases(flows: Flow[], suiteId: string): FlowUse[] {
  const out: FlowUse[] = [];
  for (const f of flows) {
    const node = f.nodes.find((n) => (n.type === "run-suite" || n.type === "run-case") && n.suiteId === suiteId);
    if (node) out.push({ flowId: f.id, flowName: f.name || "(unnamed flow)", nodeId: node.id });
  }
  return out;
}

/** "Used by Login then data" or "Used by 2 flows". Empty when nothing uses it. */
export function usedByLabel(uses: FlowUse[]): string {
  if (uses.length === 0) return "";
  return uses.length === 1 ? `Used by ${uses[0].flowName}` : `Used by ${uses.length} flows`;
}
