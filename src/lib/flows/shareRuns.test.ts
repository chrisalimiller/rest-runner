import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import { newSuite, newTestCase } from "../testing/suites";
import { sourceLabel, type TestRun } from "../testing/testRun";
import { runFlow } from "./engine";
import { newEdge, newFlow, newNode } from "./flows";
import { testRunsFromFlowRun } from "./shareRuns";
import { buildScheduleFlow, ensureScheduleFlow, findScheduleFlow } from "./suiteSchedule";
import type { Flow, FlowNode } from "./types";

const send: SendFn = async (req) => ({
  ok: true,
  request: req,
  sentAt: new Date().toISOString(),
  response: { status: 200, statusText: "", headers: [], body: "{}", sizeBytes: 2, durationMs: 1 },
});

async function runWith(kinds: ("run-suite" | "run-case")[], entry?: string) {
  const tc = { ...newTestCase(), assertions: [] };
  tc.request = { ...tc.request, url: "https://api.test/x" };
  const suite = { ...newSuite("Tickets"), cases: [tc] };
  const base = newFlow("Nightly regression");
  let prev = base.nodes[0];
  const nodes: FlowNode[] = [...base.nodes];
  const edges = [];
  for (const k of kinds) {
    const n = newNode(k) as FlowNode & { suiteId: string; caseId?: string };
    n.suiteId = suite.id;
    if (k === "run-case") n.caseId = tc.id;
    nodes.push(n);
    edges.push(newEdge(prev.id, prev.type === "start" || prev.type === "schedule" ? "next" : "passed", n.id));
    prev = n;
  }
  const flow: Flow = { ...base, nodes, edges };
  const run = await runFlow(flow, { suites: [suite], findRequest: () => null, envVars: {}, environmentName: "Dev", send, scripts: inlineScriptRunner, signal: new AbortController().signal, entryNodeId: entry, trigger: entry ?? "manual" });
  return { run, suite };
}

describe("sharing Run suite reports with Testing", () => {
  it("copies each Run suite report with a source tag and a new id", async () => {
    const { run } = await runWith(["run-suite", "run-case"]);
    let n = 0;
    const copies = testRunsFromFlowRun(run, () => `copy-${++n}`);
    expect(copies).toHaveLength(1);
    const child = run.stepList.find((s) => s.nodeType === "run-suite")!.child!;
    expect(copies[0].id).toBe("copy-1");
    expect(copies[0].id).not.toBe(child.id);
    expect(copies[0].suiteId).toBe(child.suiteId);
    expect(copies[0].environmentName).toBe("Dev");
    expect(copies[0].source).toEqual({ kind: "flow", flowId: run.flowId, flowName: "Nightly regression", flowRunId: run.id, trigger: "manual" });
    // The flow run's own step is untouched.
    expect(child.source).toBeUndefined();
  });

  it("copies nothing for a flow with only Run case steps", async () => {
    const { run } = await runWith(["run-case"]);
    expect(testRunsFromFlowRun(run, () => "x")).toEqual([]);
  });

  it("labels scheduled and manual runs, and runs started in Testing have no label", () => {
    const base = { kind: "flow" as const, flowId: "f", flowName: "Nightly regression", flowRunId: "r" };
    expect(sourceLabel({ ...base, trigger: "s1", triggerLabel: "Weekdays at 07:30" })).toBe("⏱ via flow Nightly regression");
    expect(sourceLabel({ ...base, trigger: "manual" })).toBe("via flow Nightly regression");
    expect(sourceLabel(undefined)).toBeNull();
  });

  it("a saved summary list can mix tagged and untagged runs (the old shape has no source)", () => {
    const old = { id: "a", kind: "test", suiteId: "s" } as Partial<TestRun>;
    expect(sourceLabel(old.source)).toBeNull();
  });
});

describe("Schedule… for a suite", () => {
  const suite = { ...newSuite("Tickets") };

  it("builds a switched-off weekdays 07:30 flow: Schedule → Run suite", () => {
    const { flow, scheduleNodeId } = buildScheduleFlow(suite);
    expect(flow.name).toBe("Tickets schedule");
    const sched = flow.nodes.find((n) => n.id === scheduleNodeId)!;
    expect(sched).toMatchObject({ type: "schedule", enabled: false, schedule: { kind: "weekdays", time: "07:30", days: [1, 2, 3, 4, 5] } });
    const run = flow.nodes.find((n) => n.type === "run-suite")!;
    expect(run).toMatchObject({ suiteId: suite.id });
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0]).toMatchObject({ source: scheduleNodeId, sourceHandle: "next", target: run.id });
    expect(run.position.x).toBeGreaterThan(sched.position.x);
  });

  it("finds the existing two-step flow instead of making another", () => {
    const first = ensureScheduleFlow([], suite);
    expect(first.created).toBe(true);
    const again = ensureScheduleFlow(first.flows, suite);
    expect(again.created).toBe(false);
    expect(again.flows).toBe(first.flows);
    expect(again.flow.id).toBe(first.flow.id);
    expect(again.scheduleNodeId).toBe(first.scheduleNodeId);
  });

  it("ignores flows for other suites, bigger flows and notes do not count as steps", () => {
    const other = buildScheduleFlow({ ...newSuite("Other") });
    expect(findScheduleFlow([other.flow], suite.id)).toBeNull();
    const mine = buildScheduleFlow(suite);
    const withExtra: Flow = { ...mine.flow, nodes: [...mine.flow.nodes, newNode("wait")] };
    expect(findScheduleFlow([withExtra], suite.id)).toBeNull();
    const withNote: Flow = { ...mine.flow, nodes: [...mine.flow.nodes, newNode("note")] };
    expect(findScheduleFlow([withNote], suite.id)?.flow.id).toBe(mine.flow.id);
  });
});

describe("schedule flow environment", () => {
  it("pins the given environment on the Schedule step", () => {
    const suite = { ...newSuite("Users") };
    const { flow, scheduleNodeId } = buildScheduleFlow(suite, "local");
    const node = flow.nodes.find((n) => n.id === scheduleNodeId);
    expect(node && node.type === "schedule" && node.environmentId).toBe("local");
    expect(ensureScheduleFlow([], suite, null).flow.nodes.some((n) => n.type === "schedule" && n.environmentId === null)).toBe(true);
  });
});
