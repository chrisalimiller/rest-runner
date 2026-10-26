import type { ScriptOutput } from "./testing/types";

export interface ScriptRunLike {
  pre?: ScriptOutput;
  post?: ScriptOutput;
}

export type ScriptPhase = "Pre-request" | "Post-response";

export interface ScriptSummary {
  errors: { phase: ScriptPhase; error: string }[];
  /** Every rr.test result, pre-request script first. */
  tests: { phase: ScriptPhase; name: string; passed: boolean; error?: string }[];
  /** Console output per script that wrote any. */
  logs: { phase: ScriptPhase; lines: string[] }[];
  /** Run variables when the last script finished (the post-response script's, else the pre-request script's). */
  vars: Record<string, string>;
  passed: number;
  total: number;
  failed: boolean;
}

/** What a send's scripts did, in the order the Scripts tab shows it: errors, tests, variables, console. */
export function summarizeScripts(run: ScriptRunLike | null | undefined): ScriptSummary {
  const phases: [ScriptPhase, ScriptOutput | undefined][] = [
    ["Pre-request", run?.pre],
    ["Post-response", run?.post],
  ];
  const errors = phases.flatMap(([phase, o]) => (o?.error ? [{ phase, error: o.error }] : []));
  const tests = phases.flatMap(([phase, o]) => (o?.tests ?? []).map((t) => ({ phase, ...t })));
  const logs = phases.flatMap(([phase, o]) => (o && o.logs.length ? [{ phase, lines: o.logs }] : []));
  const passed = tests.filter((t) => t.passed).length;
  return {
    errors,
    tests,
    logs,
    vars: run?.post?.vars ?? run?.pre?.vars ?? {},
    passed,
    total: tests.length,
    failed: passed < tests.length || errors.length > 0,
  };
}

/** "Tests 2/2", or null when no script called rr.test. */
export function testsBadge(run: ScriptRunLike | null | undefined): string | null {
  const s = summarizeScripts(run);
  return s.total ? `Tests ${s.passed}/${s.total}` : null;
}
