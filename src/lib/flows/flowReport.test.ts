import { describe, expect, it } from "vitest";
import { maskSecrets } from "../secrets";
import type { SendFn } from "../batch";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import { newSuite, newTestCase } from "../testing/suites";
import { DEFAULT_SUITE_OPTIONS, type TestSuite } from "../testing/types";
import { parseRecords } from "../csv";
import { CALL_COLUMNS } from "../reportCsv";
import { runFlow } from "./engine";
import { END_LABELS, endTone, flowReportFileName, orderedSteps, singleCall, stepResultLabel, stepStatusCode, toFlowCsvReport, toFlowHtmlReport, variableRows } from "./flowReport";
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
    const [head, , , , caseRow] = parseRecords(csv.slice(1).trimEnd(), ",");
    expect(head.slice(11, 15)).toEqual(["case", "iteration", "case_result", "failed_checks"]);
    expect(head.slice(15, 15 + CALL_COLUMNS.length)).toEqual([...CALL_COLUMNS]);
    expect(head.slice(15 + CALL_COLUMNS.length)).toEqual(["script_output", "case_notes", "flow_result"]);
    expect(caseRow[head.indexOf("url")]).toBe("https://api.test/fail");
    expect(caseRow[head.indexOf("response_body")]).toBe("{}");
    expect(caseRow[head.indexOf("response_size_bytes")]).toBe("2");
  });

  it("builds a self-contained HTML report with each child report shown inline and escaped", async () => {
    const run = await sampleRun();
    const html = toFlowHtmlReport(run);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Nightly, smoke");
    expect(html).toContain("https://api.test/fail");
    expect(html).not.toContain("<iframe");
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

it("guards flow step labels in exported CSV", async () => {
  const run = await sampleRun();
  const modified = { ...run, stepList: run.stepList.map((step) => ({ ...step, label: "=label" })) };
  const [head, row] = parseRecords(toFlowCsvReport(modified).slice(1).trimEnd(), ",");
  expect(row[head.indexOf("step_name")]).toBe("'=label");
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

  it("finds the single call of a one-result step only", async () => {
    const step = orderedSteps(await sampleRun())[2];
    expect(singleCall(step)?.caseName).toBe("Get <ticket>");
    const result = step.child!.results[0];
    expect(singleCall({ ...step, child: { ...step.child!, results: [] } })).toBeUndefined();
    expect(singleCall({ ...step, child: { ...step.child!, results: [result, result] } })).toBeUndefined();
    expect(singleCall({ ...step, child: undefined })).toBeUndefined();
  });

  it("keeps the embedded report for a multi-call step and adds the status to the result", async () => {
    const run = await sampleRun();
    const step = orderedSteps(run)[2];
    const result = step.child!.results[0];
    const multi = { ...run, stepList: run.stepList.map((s) => (s.index === 2 ? { ...s, child: { ...s.child!, results: [result, result] } } : s)) };
    expect(toFlowHtmlReport(multi)).toContain("iframe");
    expect(stepResultLabel(step)).toMatch(/ · 500$/);
    expect(toFlowHtmlReport(run)).toContain(`· 500</span>`);
  });
});

it("redacts report data before search indexes, CSV and nested srcdoc encoding without changing the run", async () => {
  const secret = 'MiX&"Secret';
  const run = await sampleRun();
  const step = run.stepList.find((s) => s.child)!;
  const result = step.child!.results[0];
  result.caseName = secret;
  result.notes = [secret, encodeURIComponent(secret), JSON.stringify(secret)];
  step.label = secret;
  step.varsAfter = { [secret]: secret, status: secret, type: secret };
  step.child!.results.push(structuredClone(result));
  const before = JSON.stringify(run);
  // The previous export masked only the completed markup and leaves a doubly escaped secret.
  const oldExport = maskSecrets(toFlowHtmlReport(run), [secret]);
  expect(oldExport).toContain("MiX&amp;amp;");
  const html = toFlowHtmlReport(run, { secrets: [secret] });
  const csv = toFlowCsvReport(run, { secrets: [secret] });
  expect(html).toContain("<iframe");
  expect(html).not.toContain(secret);
  expect(html.toLowerCase()).not.toContain(secret.toLowerCase());
  expect(html).not.toContain("MiX&amp;amp;");
  const srcdoc = html.match(/srcdoc="([^"]*)"/)![1];
  const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const child = decode(srcdoc);
  expect(decode(child)).not.toContain(secret);
  expect(child.toLowerCase()).not.toContain(secret.toLowerCase());
  expect(csv).not.toContain(secret);
  expect(csv).not.toContain(encodeURIComponent(secret));
  expect(csv).not.toContain("MiX&");
  expect(JSON.stringify(run)).toBe(before);
});
