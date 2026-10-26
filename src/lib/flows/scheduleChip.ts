import { describeSchedule, nextDueAfter } from "./schedule";
import type { Flow, FlowRunSummary } from "./types";

export interface ScheduleChip {
  nodeId: string;
  enabled: boolean;
  /** "Daily at 09:00". */
  label: string;
  /** "next 09:00", "next tomorrow 09:00" or "off"; empty when no next time can be worked out. */
  next: string;
  /** How many Schedule steps the flow has (the chip shows the first). */
  count: number;
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The flow's schedule as one line for its header, or null when it has no Schedule step. */
export function scheduleChip(flow: Flow, now: Date): ScheduleChip | null {
  const nodes = flow.nodes.filter((n): n is Extract<typeof n, { type: "schedule" }> => n.type === "schedule");
  if (nodes.length === 0) return null;
  const node = nodes.find((n) => n.enabled) ?? nodes[0];
  const due = node.enabled ? nextDueAfter(node.schedule, now) : null;
  let next = "";
  if (!node.enabled) next = "off";
  else if (due) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    next = sameDay(due, now) ? `next ${clock(due)}` : sameDay(due, tomorrow) ? `next tomorrow ${clock(due)}` : `next ${due.toLocaleDateString(undefined, { weekday: "short" })} ${clock(due)}`;
  }
  return { nodeId: node.id, enabled: node.enabled, label: describeSchedule(node.schedule), next, count: nodes.length };
}

/** What starts a run, for lists: "Scheduled · Daily at 09:00", or null for the Run button. */
export function triggerText(run: Pick<FlowRunSummary, "trigger" | "triggerLabel">): string | null {
  if (run.trigger === "manual") return null;
  return run.triggerLabel ? `Scheduled · ${run.triggerLabel}` : "Scheduled";
}
