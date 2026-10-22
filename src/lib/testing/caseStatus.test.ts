import { describe, expect, it } from "vitest";
import { assertionResults, failureLine, failureReason, latestCaseResult, runFailures } from "./caseStatus";
import { newAssertion } from "./suites";
import type { TestRun } from "./testRun";
import type { CaseResult } from "./types";

function result(p: Partial<CaseResult> = {}): CaseResult {
  return {
    iteration: 0,
    rowIndex: null,
    repeatIndex: 0,
    caseId: "c1",
    caseName: "Get ticket",
    caseIndex: 0,
    vars: { want: "acknowledged" },
    outcome: {
      ok: true,
      request: { method: "GET", url: "https://x", headers: [] },
      response: { status: 201, statusText: "Created", headers: [["Content-Type", "application/json"]], body: '{"status":"acknowledged","id":"T1"}', sizeBytes: 10, durationMs: 412 },
      sentAt: "2026-10-22T12:00:00Z",
    },
    checks: [],
    passed: true,
    notes: [],
    startedAt: "2026-10-22T12:00:00Z",
    durationMs: 420,
    ...p,
  };
}

const runOf = (results: CaseResult[]) => ({ results }) as unknown as TestRun;

describe("latestCaseResult", () => {
  it("prefers Try case, then the first failed iteration of the run, then the first", () => {
    const a = result({ iteration: 0 });
    const b = result({ iteration: 1, passed: false });
    const tried = result({ iteration: 9 });
    expect(latestCaseResult("c1", tried, runOf([a, b]))).toBe(tried);
    expect(latestCaseResult("c1", null, runOf([a, b]))).toBe(b);
    expect(latestCaseResult("c1", null, runOf([a]))).toBe(a);
    expect(latestCaseResult("other", null, runOf([a]))).toBeNull();
    expect(latestCaseResult("c1", null, null)).toBeNull();
  });
});

describe("assertionResults", () => {
  it("shows pass/fail and the value seen for each assertion", () => {
    const status = newAssertion({ source: "status", op: "eq", expected: "201" });
    const field = newAssertion({ source: "json", property: "$.status", op: "eq", expected: "{{want}}" });
    const time = newAssertion({ source: "time", op: "lt", expected: "300" });
    const map = assertionResults([status, field, time], result());
    expect(map.get(status.id)).toEqual({ passed: true, actual: "201" });
    expect(map.get(field.id)?.passed).toBe(true);
    expect(map.get(field.id)?.actual).toContain("acknowledged");
    expect(map.get(time.id)).toEqual({ passed: false, actual: "412" });
  });

  it("uses variables set by the post-response script", () => {
    const a = newAssertion({ source: "json", property: "$.id", op: "eq", expected: "{{id}}" });
    const r = result({ postScript: { tests: [], logs: [], vars: { id: "T1" }, durationMs: 1 } });
    expect(assertionResults([a], r).get(a.id)?.passed).toBe(true);
  });

  it("is empty without a response", () => {
    expect(assertionResults([newAssertion()], result({ outcome: undefined })).size).toBe(0);
    expect(assertionResults([newAssertion()], null).size).toBe(0);
  });
});

describe("failure text", () => {
  const failed = result({
    rowIndex: 16,
    passed: false,
    checks: [
      { name: "Status equals 201", passed: true, source: "assertion", message: "Got 201" },
      { name: "Response time less than 300", passed: false, source: "assertion", message: "Got 412" },
    ],
  });

  it("names the first failing check and the CSV row", () => {
    expect(failureLine(failed)).toBe("✕ Response time less than 300 — got 412 (row 17)");
    expect(failureReason(failed)).toBe("412");
  });

  it("uses the status code for status failures and says when nothing came back", () => {
    expect(failureReason(result({ passed: false, checks: [{ name: "Status is below 400", passed: false, source: "status", message: "Got 422" }] }))).toBe("201");
    expect(failureReason(result({ outcome: undefined, passed: false }))).toBe("not sent");
  });

  it("lists a run's failures in order", () => {
    const list = runFailures(runOf([result(), failed]));
    expect(list).toEqual([{ index: 1, where: "row 17", caseId: "c1", caseName: "Get ticket", reason: "412" }]);
  });
});
