import type { CaseRuns, TestCase } from "./types";

export interface PlanEstimate {
  /** Cases that will be sent: data rows × enabled cases × repeats. */
  total: number;
  text: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The most times a suite can repeat (Run settings allow 1 to this). */
export const MAX_REPEAT = 1000;

/** A repeat count from the settings or an imported file, as a whole number from 1 to MAX_REPEAT. */
export function clampRepeat(repeat: unknown): number {
  const n = Math.floor(Number(repeat));
  return Number.isFinite(n) ? Math.min(MAX_REPEAT, Math.max(1, n)) : 1;
}

/** When a case runs. Missing (suites saved before setup cases) means every row. */
export function caseRuns(tc: Pick<TestCase, "runs">): CaseRuns {
  return tc.runs === "before" || tc.runs === "after" ? tc.runs : "each";
}

export interface CaseSlot {
  testCase: TestCase;
  /** Position in the suite's own list. */
  caseIndex: number;
}

/** The suite's cases split by when they run, each group in suite order. */
export function splitCases(cases: TestCase[], enabledOnly = false): { before: CaseSlot[]; each: CaseSlot[]; after: CaseSlot[] } {
  const out = { before: [] as CaseSlot[], each: [] as CaseSlot[], after: [] as CaseSlot[] };
  cases.forEach((testCase, caseIndex) => {
    if (enabledOnly && !testCase.enabled) return;
    out[caseRuns(testCase)].push({ testCase, caseIndex });
  });
  return out;
}

/** Requests a run will make: setup and teardown once, the rest once per iteration. */
export function plannedCases(cases: TestCase[], iterations: number): number {
  const { before, each, after } = splitCases(cases, true);
  return before.length + after.length + each.length * iterations;
}

/** "36 cases planned (12 rows × 3 cases × 1 repeat)". With no CSV the rows part is left out. Setup and teardown run once per run, not once per repeat. */
export function planEstimate(rows: number | null, enabledCases: number, repeat: number, setup = 0, teardown = 0): PlanEstimate {
  const times = clampRepeat(repeat);
  const data = rows !== null && rows > 0 ? rows : null;
  const once = setup + teardown;
  const total = (data ?? 1) * enabledCases * times + once;
  const parts = [
    setup > 0 ? `${setup} setup` : null,
    teardown > 0 ? `${teardown} teardown` : null,
    [data !== null ? plural(data, "row") : null, plural(enabledCases, "case"), plural(times, "repeat")].filter(Boolean).join(" × "),
  ].filter(Boolean);
  return { total, text: `${plural(total, "case")} planned (${parts.join(" + ")})` };
}
