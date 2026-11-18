import { describe, expect, it } from "vitest";
import type { Environment } from "../environments";
import { addStepAfter, cleanFlows, cleanImportedFlows, newFlow, newNode } from "./flows";
import { scheduleChip } from "./scheduleChip";
import { scheduleEnvironment, scheduleEnvironmentText } from "./scheduleEnv";
import type { Flow, ScheduleNode } from "./types";
import { hasErrors, validateFlow } from "./validate";

const env = (id: string, name: string, color?: Environment["color"]): Environment => ({ id, name, vars: [], color });
const envs = [env("local", "Local", "green"), env("prod", "Production", "red")];
const sched = (extra: Partial<ScheduleNode> = {}): ScheduleNode => ({ ...(newNode("schedule") as ScheduleNode), id: "s", schedule: { kind: "weekdays", time: "07:30", days: [1, 2, 3, 4, 5] }, ...extra });
const flowWith = (node: ScheduleNode): Flow => ({ ...newFlow("F"), nodes: [node] });

describe("scheduleEnvironment", () => {
  it("uses the pinned environment even when the Flows switch shows another", () => {
    const r = scheduleEnvironment(sched({ environmentId: "local" }), envs, "prod");
    expect(r.env?.id).toBe("local");
    expect(r.follows).toBe(false);
  });
  it("follows the Flows switch for an old node without the field", () => {
    const node = sched();
    delete node.environmentId;
    const r = scheduleEnvironment(node, envs, "prod");
    expect(r).toMatchObject({ follows: true, missing: false });
    expect(r.env?.id).toBe("prod");
    expect(scheduleEnvironmentText(r)).toBe("Flows switch");
  });
  it("allows No environment", () => {
    const r = scheduleEnvironment(sched({ environmentId: null }), envs, "prod");
    expect(r).toMatchObject({ env: null, follows: false, missing: false });
    expect(scheduleEnvironmentText(r)).toBe("No environment");
  });
  it("flags a deleted environment", () => {
    const r = scheduleEnvironment(sched({ environmentId: "gone" }), envs, "prod");
    expect(r).toMatchObject({ env: null, missing: true });
  });
});

describe("new Schedule steps", () => {
  it("pin the environment selected in Flows when added", () => {
    expect((newNode("schedule", { x: 0, y: 0 }, "local") as ScheduleNode).environmentId).toBe("local");
    expect((newNode("schedule", { x: 0, y: 0 }, null) as ScheduleNode).environmentId).toBeNull();
    const { node } = addStepAfter(newFlow(), "nope", null, "schedule", "local");
    expect(node).toBeNull();
    const f = newFlow();
    const added = addStepAfter(f, f.nodes[0].id, null, "schedule", "prod");
    expect((added.node as ScheduleNode).environmentId).toBe("prod");
  });
  it("leave it unset when no environment is given", () => {
    expect("environmentId" in newNode("schedule")).toBe(false);
  });
});

describe("validation", () => {
  const check = (node: ScheduleNode) => validateFlow(flowWith(node), [], () => null, { environmentIds: envs.map((e) => e.id) });
  it("makes a missing pinned environment an error on the Schedule step", () => {
    const problems = check(sched({ environmentId: "gone" }));
    expect(hasErrors(problems)).toBe(true);
    expect(problems.find((p) => p.nodeId === "s" && p.message.includes("environment was deleted"))).toBeTruthy();
  });
  it("accepts a pinned, absent or null environment", () => {
    expect(check(sched({ environmentId: "local" })).some((p) => p.message.includes("environment"))).toBe(false);
    expect(check(sched({ environmentId: null })).some((p) => p.message.includes("environment"))).toBe(false);
    expect(check(sched()).some((p) => p.message.includes("environment"))).toBe(false);
  });
});

describe("cleaning and import", () => {
  const raw = (environmentId: unknown) => [{ id: "f", name: "F", nodes: [{ id: "s", type: "schedule", schedule: { kind: "daily", time: "09:00" }, enabled: true, environmentId, position: { x: 0, y: 0 } }], edges: [] }];
  const field = (flows: Flow[]) => (flows[0].nodes[0] as ScheduleNode).environmentId;
  it("keeps a string or null and drops bad values", () => {
    expect(field(cleanFlows(raw("local")))).toBe("local");
    expect(field(cleanFlows(raw(null)))).toBeNull();
    expect("environmentId" in cleanFlows(raw(42))[0].nodes[0]).toBe(false);
    expect("environmentId" in cleanFlows(raw(undefined))[0].nodes[0]).toBe(false);
  });
  it("keeps the environment on import and turns the schedule off", () => {
    const [f] = cleanImportedFlows(raw("elsewhere"));
    const n = f.nodes[0] as ScheduleNode;
    expect(n.environmentId).toBe("elsewhere");
    expect(n.enabled).toBe(false);
  });
});

describe("chip text", () => {
  const now = new Date(2026, 9, 26, 8, 0);
  it("names the environment and carries its colour", () => {
    const chip = scheduleChip(flowWith(sched({ environmentId: "prod" })), now, envs, "local");
    expect(chip).toMatchObject({ label: "Mon, Tue, Wed, Thu, Fri at 07:30", environment: "Production" });
    expect(chip?.env?.color).toBe("red");
  });
  it("says Flows switch for an old node and No environment for null", () => {
    const old = sched();
    delete old.environmentId;
    expect(scheduleChip(flowWith(old), now, envs, "local")?.environment).toBe("Flows switch");
    expect(scheduleChip(flowWith(sched({ environmentId: null })), now, envs, "local")?.environment).toBe("No environment");
  });
});
