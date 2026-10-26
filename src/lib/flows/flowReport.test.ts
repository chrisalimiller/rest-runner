import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import { inlineScriptRunner } from "../testing/scriptRunner";
import { newSuite, newTestCase } from "../testing/suites";
import { DEFAULT_SUITE_OPTIONS, type TestSuite } from "../testing/types";
import { runFlow } from "./engine";
import { END_LABELS, endTone, flowReportFileName, orderedSteps, stepStatusCode, toFlowCsvReport, toFlowHtmlReport, variableRows } from "./flowReport";
import { newEdge, newFlow, newNode } from "./flows";
import type { Flow, FlowNode, FlowRun } from "./types";

const send: SendFn = async (req) => ({
  ok: true,
  request: req,
  sentAt: new Date().toISOString(),
  response: { status: req.url.includes("fail") ? 500 : 200, statusText: "", headers: [], body: "{}", sizeBytes: 2, durationMs: 1 },
});

async function sampleRun(): Promise<FlowRun> {
  const tc = { ...newTestCase(), name: "Get <ticket>", assertions: [] };
  tc.request = { ...tc.request, url: "https://api.test/fail" };
  tc.assertions = [{ id: "a1", enabled: true, source: "status", property: "", op: "eq", expected: "200" } as never];
  const suite: TestSuite = { ...newSuite("Tickets"), cases: [tc], options: { ...DEFAULT_SUITE_OPTIONS } };
  const flow = newFlow("Nightly, smoke");
  const set = { ...newNode("set-var"), name: "id", value: "42" } as FlowNode;
  const run = { ...newNode("run-case"), suiteId: suite.id, caseId: tc.id } as FlowNode;
  const f: Flow = { ...flow, nodes: [...flow.nodes, set, run], edges: [newEdge(flow.nodes[0].id, "next", set.id), newEdge(set.id, "next", run.id)] };
  return runFlow(f, { suites: [suite], findRequest: () => null, envVars: {}, environmentName: "Dev", send, scripts: inlineScriptRunner, signal: new AbortController().signal });
}

describe("flow reports", () => {
  it("writes one CSV line per step and one per case result inside a Run step", async () => {
    const run = await sampleRun();
    expect(run.end).toBe("failed");
    const csv = toFlowCsvReport(run);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    // Header, Start, Set variable, Run case, and its one case result.
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^step,branch,loop_row,step_name/);
    expect(lines[2]).toContain('id = ""42""');
    expect(lines[4]).toContain("Get <ticket>");
    expect(lines[4]).toContain("FAIL");
    expect(lines[4]).toContain("500");
  });

  it("builds a self-contained HTML report with each child report embedded and escaped", async () => {
    const run = await sampleRun();
    const html = toFlowHtmlReport(run);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Nightly, smoke");
    expect(html).toContain("<iframe");
    expect(html).not.toContain("<ticket>");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(orderedSteps(run).map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("names report files after the flow and its start time", async () => {
    const run = await sampleRun();
    expect(flowReportFileName(run, "csv")).toMatch(/^Nightly, smoke \d{4}-\d\d-\d\d \d\d-\d\d\.csv$/);
    expect(flowReportFileName({ ...run, flowName: 'a/b:c*"d"' }, "html")).toMatch(/^a b c d \d{4}/);
  });
});

describe("variableRows", () => {
  it("lists every variable once, marking new, changed and removed ones", () => {
    const rows = variableRows({ token: "a", ticketId: "TT-1", old: "x" }, { ticketId: "TT-2", token: "a", siteId: "MN-1" });
    expect(rows).toEqual([
      { name: "siteId", value: "MN-1", change: "new" },
      { name: "ticketId", value: "TT-2", change: "changed" },
      { name: "token", value: "a", change: null },
      { name: "old", value: "x", change: "removed" },
    ]);
  });

  it("returns nothing when there are no variables", () => {
    expect(variableRows({}, {})).toEqual([]);
  });
});

describe("run results", () => {
  it("labels a flow that passed through handled failures, in amber, in both exports", async () => {
    const run = { ...(await sampleRun()), end: "passed-handled" as const };
    expect(END_LABELS["passed-handled"]).toBe("Passed with handled failures");
    expect(endTone("passed-handled")).toBe("warn");
    expect(endTone("passed")).toBe("ok");
    expect(endTone("failed")).toBe("bad");
    const html = toFlowHtmlReport(run);
    expect(html).toContain("Passed with handled failures");
    expect(html).toContain('<b class="warn">');
    const csv = toFlowCsvReport(run).split("\r\n");
    expect(csv[0].endsWith("flow_result")).toBe(true);
    expect(csv[1].endsWith("Passed with handled failures")).toBe(true);
  });

  it("reads the last status code of a Run step", async () => {
    const run = await sampleRun();
    const steps = orderedSteps(run);
    expect(stepStatusCode(steps[0])).toBeUndefined();
    expect(stepStatusCode(steps[2])).toBe(500);
  });
});
