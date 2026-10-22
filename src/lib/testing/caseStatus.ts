import { evaluateAssertion } from "./assertions";
import type { TestRun } from "./testRun";
import type { Assertion, CaseResult, Check } from "./types";

/** What the Testing runbook shows for each case: its latest result, per-assertion values, and failure lines. */

/** The latest result for a case: its Try case result, or else from the latest run the first failed iteration, otherwise the first. */
export function latestCaseResult(caseId: string, tried: CaseResult | null | undefined, run: TestRun | null | undefined): CaseResult | null {
  if (tried) return tried;
  if (!run) return null;
  const mine = run.results.filter((r) => r.caseId === caseId);
  return mine.find((r) => !r.passed) ?? mine[0] ?? null;
}

export interface AssertionResult {
  passed: boolean;
  /** The value seen, or why it could not be read. */
  actual: string;
}

/**
 * Re-checks each assertion against a result's response, using the variables the case
 * had after its post-response script. Assertions are matched by id, so edits made
 * since the result show their new outcome.
 */
export function assertionResults(assertions: Assertion[], result: CaseResult | null): Map<string, AssertionResult> {
  const out = new Map<string, AssertionResult>();
  const o = result?.outcome;
  if (!result || !o || !o.ok) return out;
  const vars = { ...result.vars, ...(result.postScript?.vars ?? {}) };
  for (const a of assertions) {
    const check = evaluateAssertion(a, o.response, vars);
    out.set(a.id, { passed: check.passed, actual: (check.message ?? "").replace(/^Got /, "") });
  }
  return out;
}

export function checkCounts(result: CaseResult): { passed: number; total: number } {
  return { passed: result.checks.filter((c) => c.passed).length, total: result.checks.length };
}

/** "row 17" for a CSV row, "iteration 3" for a repeat, or "" for a single pass. */
export function whereLabel(result: CaseResult): string {
  if (result.rowIndex !== null) return `row ${result.rowIndex + 1}`;
  return result.iteration > 0 ? `iteration ${result.iteration + 1}` : "";
}

function firstFailing(result: CaseResult): Check | undefined {
  return result.checks.find((c) => !c.passed);
}

/** "✕ Response time less than 300 — got 412 (row 17)": the first failing check, or why the case failed. */
export function failureLine(result: CaseResult): string {
  const where = whereLabel(result);
  const suffix = where ? ` (${where})` : "";
  const check = firstFailing(result);
  if (check) {
    const msg = check.message ? ` — ${check.message.replace(/^Got /, "got ")}` : "";
    return `✕ ${check.name}${msg}${suffix}`;
  }
  if (!result.outcome) return `✕ Not sent${result.notes[0] ? ` — ${result.notes[0]}` : ""}${suffix}`;
  return `✕ Failed${suffix}`;
}

/** A short reason for the failures list: the status code, the value seen, or "no response". */
export function failureReason(result: CaseResult): string {
  const o = result.outcome;
  if (!o) return "not sent";
  if (!o.ok) return "no response";
  const check = firstFailing(result);
  if (!check) return "failed";
  if (check.source === "status") return String(o.response.status);
  const seen = (check.message ?? "").replace(/^Got /, "");
  const unit = seen && /^Response time/i.test(check.name) && /^\d+$/.test(seen) ? " ms" : "";
  const text = seen ? seen + unit : check.name;
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

export interface FailureItem {
  index: number;
  where: string;
  caseId: string;
  caseName: string;
  reason: string;
}

/** Failed cases of a run, in plan order. */
export function runFailures(run: TestRun, limit = 50): FailureItem[] {
  const out: FailureItem[] = [];
  run.results.forEach((r, index) => {
    if (!r.passed && out.length < limit) out.push({ index, where: r.rowIndex !== null ? `row ${r.rowIndex + 1}` : `iter ${r.iteration + 1}`, caseId: r.caseId, caseName: r.caseName, reason: failureReason(r) });
  });
  return out;
}
