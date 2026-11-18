import type { TestRun } from "../testing/testRun";
import type { FlowRun } from "./types";

/**
 * The reports of a finished flow run's Run suite steps, as test runs to save in Testing. Each is a copy with a new id
 * and a source tag, so deleting the flow run or the test run leaves the other alone. Run case and Run request steps
 * are not shared. A step that tried more than once keeps only its last try, which is the one `child` holds.
 */
export function testRunsFromFlowRun(run: FlowRun, makeId: () => string): TestRun[] {
  return run.stepList
    .filter((s) => s.nodeType === "run-suite" && s.child)
    .map((s) => ({
      ...structuredClone(s.child!),
      id: makeId(),
      source: {
        kind: "flow" as const,
        flowId: run.flowId,
        flowName: run.flowName,
        flowRunId: run.id,
        trigger: run.trigger,
        ...(run.triggerLabel ? { triggerLabel: run.triggerLabel } : {}),
      },
    }));
}
