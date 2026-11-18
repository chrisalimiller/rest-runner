import type { TestSuite } from "./types";

/** What an "open this suite (and case)" command from Flows should show. */
export type OpenTarget = { ok: true; suiteId: string; caseId: string | null; notice: string | null } | { ok: false; notice: string };

/** Finds the suite and case a Flows step points at. A missing case still opens the suite, with a notice. */
export function resolveOpenTarget(suites: TestSuite[], suiteId: string, caseId?: string): OpenTarget {
  const suite = suites.find((s) => s.id === suiteId);
  if (!suite) return { ok: false, notice: "That suite no longer exists." };
  if (!caseId) return { ok: true, suiteId: suite.id, caseId: null, notice: null };
  if (!suite.cases.some((c) => c.id === caseId)) return { ok: true, suiteId: suite.id, caseId: null, notice: "That case no longer exists." };
  return { ok: true, suiteId: suite.id, caseId, notice: null };
}
