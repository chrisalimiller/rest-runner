import { durationOf, MAX_SAVED_BODY, type RunLogLine } from "../run";
import type { SendOutcome } from "../types";
import { describeMode } from "./describe";
import type { CaseResult, SuiteRunEnd, SuiteRunOptions, TestSuite } from "./types";

export interface TestRunSummary {
  id: string;
  kind: "test";
  suiteId: string;
  suiteName: string;
  csvName?: string;
  environmentName?: string;
  startedAt: string;
  finishedAt: string;
  end: SuiteRunEnd;
  options: SuiteRunOptions;
  iterations: number;
  /** Cases the plan called for: enabled cases × iterations. */
  plannedCases: number;
  completed: number;
  passed: number;
  failed: number;
  checksPassed: number;
  checksFailed: number;
}

export interface TestRun extends TestRunSummary {
  /** The suite as it was when the run started. */
  suite: TestSuite;
  columns: string[];
  log: RunLogLine[];
  results: CaseResult[];
}

export interface CaseStats {
  caseId: string;
  caseName: string;
  caseIndex: number;
  runs: number;
  passed: number;
  failed: number;
  avgMs: number;
  maxMs: number;
}

function trimOutcome(outcome: SendOutcome | undefined): SendOutcome | undefined {
  if (!outcome || !outcome.ok || outcome.response.body.length <= MAX_SAVED_BODY) return outcome;
  return { ...outcome, response: { ...outcome.response, body: outcome.response.body.slice(0, MAX_SAVED_BODY) } };
}

/** "3", or "1 of 3" when the run stopped before every planned iteration had a result. */
export function iterationsLabel(run: Pick<TestRun, "iterations" | "results">): string {
  const ran = new Set(run.results.map((r) => r.iteration)).size;
  return ran < run.iterations ? `${ran} of ${run.iterations}` : String(run.iterations);
}

/** Puts results in plan order: by iteration, then by the case's position in the suite. */
export function sortResults(results: CaseResult[]): CaseResult[] {
  return [...results].sort((a, b) => a.iteration - b.iteration || a.caseIndex - b.caseIndex);
}

export function requestMs(r: CaseResult): number {
  return r.outcome ? durationOf(r.outcome) : 0;
}

export function caseStats(run: TestRun): CaseStats[] {
  const map = new Map<string, CaseStats & { totalMs: number }>();
  for (const r of run.results) {
    let s = map.get(r.caseId);
    if (!s) {
      s = { caseId: r.caseId, caseName: r.caseName, caseIndex: r.caseIndex, runs: 0, passed: 0, failed: 0, avgMs: 0, maxMs: 0, totalMs: 0 };
      map.set(r.caseId, s);
    }
    const ms = requestMs(r);
    s.runs += 1;
    if (r.passed) s.passed += 1;
    else s.failed += 1;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
  }
  return [...map.values()]
    .sort((a, b) => a.caseIndex - b.caseIndex)
    .map(({ totalMs, ...s }) => ({ ...s, avgMs: s.runs ? Math.round(totalMs / s.runs) : 0 }));
}

export interface TestRunInput {
  id: string;
  suite: TestSuite;
  csvName?: string;
  columns: string[];
  iterations: number;
  environmentName?: string;
  startedAt: string;
  finishedAt: string;
  end: SuiteRunEnd;
  results: CaseResult[];
}

/** Turns raw case results into a saved test run with a summary and a run log. */
export function buildTestRun(input: TestRunInput): TestRun {
  const results = sortResults(input.results).map((r) => ({ ...r, outcome: trimOutcome(r.outcome) }));
  const enabled = input.suite.cases.filter((c) => c.enabled).length;
  const passed = results.filter((r) => r.passed).length;
  const checks = results.flatMap((r) => r.checks);
  const checksPassed = checks.filter((c) => c.passed).length;
  const o = input.suite.options;

  const log: RunLogLine[] = [
    {
      at: input.startedAt,
      message: `Started suite "${input.suite.name}": ${enabled} case${enabled === 1 ? "" : "s"} × ${input.iterations} iteration${input.iterations === 1 ? "" : "s"}${input.csvName ? ` from ${input.csvName}` : ""}.`,
    },
    { at: input.startedAt, message: `Run order: ${describeMode(o)}.` },
    { at: input.startedAt, message: input.environmentName ? `Environment: ${input.environmentName}.` : "No environment selected." },
  ];
  const firstFail = results.filter((r) => !r.passed).sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  if (firstFail) {
    const why = firstFail.checks.find((c) => !c.passed);
    log.push({
      at: firstFail.startedAt,
      message: `First failure: "${firstFail.caseName}" in iteration ${firstFail.iteration + 1}${why ? ` (${why.name}${why.message ? `: ${why.message}` : ""})` : ""}.`,
    });
  }
  log.push({
    at: input.finishedAt,
    message:
      input.end === "cancelled"
        ? "Stopped by you before every case ran."
        : input.end === "stopped-on-failure"
          ? 'Stopped after a failed case ("Stop on first failure" was on).'
          : "Every case ran.",
  });
  log.push({
    at: input.finishedAt,
    message: `Finished: ${results.length} of ${enabled * input.iterations} cases ran, ${passed} passed, ${results.length - passed} failed; ${checksPassed} of ${checks.length} checks passed.`,
  });

  return {
    id: input.id,
    kind: "test",
    suiteId: input.suite.id,
    suiteName: input.suite.name,
    csvName: input.csvName,
    environmentName: input.environmentName,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    end: input.end,
    options: o,
    iterations: input.iterations,
    plannedCases: enabled * input.iterations,
    completed: results.length,
    passed,
    failed: results.length - passed,
    checksPassed,
    checksFailed: checks.length - checksPassed,
    suite: input.suite,
    columns: input.columns,
    log,
    results,
  };
}

export function testRunSummary(run: TestRun): TestRunSummary {
  const { suite: _s, columns: _c, log: _l, results: _r, ...summary } = run;
  return summary;
}

export interface TestRunTimes {
  wallMs: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

export function testRunTimes(run: TestRun): TestRunTimes {
  const sorted = run.results.filter((r) => r.outcome).map(requestMs).sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))] : 0;
  return {
    wallMs: Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)),
    avgMs: sorted.length ? Math.round(sorted.reduce((s, d) => s + d, 0) / sorted.length) : 0,
    p95Ms: p95,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}
