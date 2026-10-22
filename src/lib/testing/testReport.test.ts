import { describe, expect, it } from "vitest";
import { importSuitesFile, toSuitesFile } from "./suiteFile";
import { newAssertion, newSuite, newTestCase } from "./suites";
import { buildTestRun } from "./testRun";
import { toTestCsvReport, toTestHtmlReport } from "./testReport";
import type { CaseResult } from "./types";

const suite = { ...newSuite("Smoke <tests>"), cases: [newTestCase()] };
suite.cases[0].name = "Get user";

const result = (passed: boolean, iteration: number): CaseResult => ({
  iteration,
  rowIndex: iteration,
  repeatIndex: 0,
  caseId: suite.cases[0].id,
  caseName: "Get user",
  caseIndex: 0,
  vars: { id: String(iteration + 1) },
  outcome: {
    ok: true,
    sentAt: "2026-01-01T00:00:00.000Z",
    request: { method: "GET", url: `https://x/users/${iteration + 1}`, headers: [["Accept", "application/json"]] },
    response: { status: passed ? 200 : 404, statusText: "", headers: [], body: '{"id":1}', sizeBytes: 8, durationMs: 12 },
  },
  postScript: { tests: [], logs: ["hello, \"world\""], vars: {}, durationMs: 1 },
  checks: [{ name: "Status code equals 200", passed, message: passed ? "Got 200" : "Got 404", source: "assertion" }],
  passed,
  notes: [],
  startedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 15,
});

const run = buildTestRun({
  id: "r",
  suite,
  csvName: "users.csv",
  columns: ["id"],
  iterations: 2,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:02.000Z",
  end: "completed",
  results: [result(true, 0), result(false, 1)],
});

describe("test reports", () => {
  it("writes one CSV line per case result with checks, script output and CSV values", () => {
    const csv = toTestCsvReport(run);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0].split(",").slice(0, 6)).toEqual(["iteration", "csv_row", "repeat", "case_number", "case", "result"]);
    expect(lines[0].endsWith("var:id")).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("FAIL");
    expect(lines[2]).toContain("Status code equals 200: Got 404");
    expect(csv).toContain('"[post] hello, ""world"""');
  });

  it("writes a self-contained HTML report with escaped names", () => {
    const html = toTestHtmlReport(run);
    expect(html).toContain("Smoke &lt;tests&gt;");
    expect(html).not.toContain("Smoke <tests>");
    expect(html).toContain("1 / 2");
    expect((html.match(/<details class="call/g) ?? []).length).toBe(2);
  });
});

describe("suite files", () => {
  it("round-trips suites and merges by id", () => {
    const a = { ...newSuite("A"), cases: [{ ...newTestCase(), assertions: [newAssertion({ source: "time", op: "lt", expected: "300" })] }] };
    const text = toSuitesFile([a]);
    const first = importSuitesFile(text, []);
    expect(first.added).toBe(1);
    expect(first.suites[0].cases[0].assertions[0]).toMatchObject({ source: "time", op: "lt", expected: "300" });
    const again = importSuitesFile(text, first.suites);
    expect([again.added, again.replaced, again.suites.length]).toEqual([0, 1, 1]);
  });

  it("rejects other files", () => {
    expect(() => importSuitesFile('{"app":"rest-runner","version":1}', [])).toThrow(/not a REST Runner test suites file/);
    expect(() => importSuitesFile("nope", [])).toThrow(/not valid JSON/);
  });
});
