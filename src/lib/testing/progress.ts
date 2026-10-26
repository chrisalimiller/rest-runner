import type { CaseResult } from "./types";

export interface CaseTally {
  passed: number;
  failed: number;
}

/** Passed and failed results so far for one case, for the count on its status disc during a run. */
export function caseTally(results: CaseResult[], caseId: string): CaseTally {
  const tally = { passed: 0, failed: 0 };
  for (const r of results) {
    if (r.caseId !== caseId) continue;
    if (r.passed) tally.passed++;
    else tally.failed++;
  }
  return tally;
}

/** The headline for a run in progress: which iteration it is on, or how many cases are done for a single pass. */
export function runningLabel(results: CaseResult[], iterations: number, planned: number): string {
  if (iterations <= 1) return `Running · ${results.length} of ${planned}`;
  let latest = 0;
  for (const r of results) latest = Math.max(latest, r.iteration);
  return `Running · iteration ${Math.min(iterations, latest + 1)} of ${iterations}`;
}
