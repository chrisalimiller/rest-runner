import { describe, expect, it } from "vitest";
import { scheduleChip, triggerText } from "./scheduleChip";
import type { Flow } from "./types";

const flow = (nodes: unknown[]) => ({ id: "f", name: "F", description: "", nodes, edges: [] }) as unknown as Flow;
const sched = (enabled: boolean) => ({ id: "s", type: "schedule", enabled, schedule: { kind: "daily", time: "09:00" }, position: { x: 0, y: 0 } });

describe("scheduleChip", () => {
  it("is null without a Schedule step", () => {
    expect(scheduleChip(flow([{ id: "a", type: "start" }]), new Date(2026, 9, 26, 8, 0))).toBeNull();
  });
  it("says when the next run is", () => {
    const now = new Date(2026, 9, 26, 8, 0);
    expect(scheduleChip(flow([sched(true)]), now)).toMatchObject({ label: "Daily at 09:00", next: "next 09:00", enabled: true });
    expect(scheduleChip(flow([sched(true)]), new Date(2026, 9, 26, 10, 0))?.next).toBe("next tomorrow 09:00");
  });
  it("says off when disabled", () => {
    expect(scheduleChip(flow([sched(false)]), new Date())).toMatchObject({ enabled: false, next: "off" });
  });
});

describe("triggerText", () => {
  it("labels scheduled runs only", () => {
    expect(triggerText({ trigger: "manual" })).toBeNull();
    expect(triggerText({ trigger: "s1", triggerLabel: "Daily at 09:00" })).toBe("Scheduled · Daily at 09:00");
    expect(triggerText({ trigger: "s1" })).toBe("Scheduled");
  });
});
