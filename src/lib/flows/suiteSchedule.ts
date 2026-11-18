import type { TestSuite } from "../testing/types";
import { newEdge, newNode, newFlow } from "./flows";
import { tidyFlow } from "./layout";
import type { Flow, FlowNode, ScheduleNode } from "./types";

type ScheduleStep = ScheduleNode;

/** A flow made of one Schedule step wired to one Run suite step for this suite (sticky notes aside), and that Schedule step. */
export function findScheduleFlow(flows: Flow[], suiteId: string): { flow: Flow; scheduleNodeId: string } | null {
  for (const flow of flows) {
    const steps = flow.nodes.filter((n) => n.type !== "note");
    if (steps.length !== 2) continue;
    const schedule = steps.find((n): n is ScheduleStep => n.type === "schedule");
    const run = steps.find((n): n is Extract<FlowNode, { type: "run-suite" }> => n.type === "run-suite");
    if (!schedule || !run || run.suiteId !== suiteId) continue;
    if (flow.edges.length === 1 && flow.edges[0].source === schedule.id && flow.edges[0].target === run.id) return { flow, scheduleNodeId: schedule.id };
  }
  return null;
}

/** A new, switched-off "<suite> schedule" flow: Schedule (weekdays 07:30) → Run suite. Nothing runs until the person turns it on. */
export function buildScheduleFlow(suite: TestSuite): { flow: Flow; scheduleNodeId: string } {
  const schedule = newNode("schedule");
  const run = newNode("run-suite");
  if (schedule.type !== "schedule" || run.type !== "run-suite") throw new Error("unexpected node types");
  schedule.schedule = { kind: "weekdays", time: "07:30", days: [1, 2, 3, 4, 5] };
  schedule.enabled = false;
  run.suiteId = suite.id;
  const base = newFlow(`${suite.name || "Suite"} schedule`);
  const flow = tidyFlow({ ...base, nodes: [schedule, run], edges: [newEdge(schedule.id, "next", run.id)] });
  return { flow, scheduleNodeId: schedule.id };
}

/** The existing schedule flow for the suite, or a new one added to the list. */
export function ensureScheduleFlow(flows: Flow[], suite: TestSuite): { flows: Flow[]; flow: Flow; scheduleNodeId: string; created: boolean } {
  const found = findScheduleFlow(flows, suite.id);
  if (found) return { flows, ...found, created: false };
  const made = buildScheduleFlow(suite);
  return { flows: [...flows, made.flow], ...made, created: true };
}
