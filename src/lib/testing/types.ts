import type { SendOutcome, RequestDef } from "../types";
import type { Vars } from "../template";

/** Where an assertion reads its value from. */
export type AssertionSource = "status" | "time" | "size" | "header" | "body" | "json";

export const ASSERTION_OPS = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "notContains",
  "exists",
  "notExists",
  "matches",
  "isType",
] as const;
export type AssertionOp = (typeof ASSERTION_OPS)[number];

/** A no-code check on the response. `expected` may contain {{placeholders}}. */
export interface Assertion {
  id: string;
  enabled: boolean;
  source: AssertionSource;
  /** Header name for "header", JSON path for "json" (e.g. $.data.items[0].id). Unused otherwise. */
  property: string;
  op: AssertionOp;
  expected: string;
}

export interface TestCase {
  id: string;
  name: string;
  enabled: boolean;
  /** The test's own copy of the request. */
  request: RequestDef;
  /** The saved request (or example) this was copied from, if any. */
  sourceRequestId?: string;
  /** JavaScript run before the request is sent. */
  preScript: string;
  /** JavaScript run after the response arrives. */
  postScript: string;
  assertions: Assertion[];
}

/**
 * sequential: every case of every iteration, one at a time, in order.
 * parallel-iterations: iterations (CSV rows / repeats) run at the same time; cases inside each run in order and share variables.
 * parallel-cases: iterations run one after another; the cases inside each run at the same time.
 */
export type RunMode = "sequential" | "parallel-iterations" | "parallel-cases";

export interface SuiteRunOptions {
  mode: RunMode;
  /** Upper limit on requests in flight for the parallel modes. */
  concurrency: number;
  /** Pause before each case after the first, per worker. */
  delayMs: number;
  /** How many times to go through the data (or through the suite once, with no CSV). */
  repeat: number;
  /** Stop starting new cases after the first failed case. */
  stopOnFailure: boolean;
  /** A 4xx/5xx response fails the case, unless the case has its own status assertion. */
  httpErrorsFail: boolean;
  /** Scripts that run longer than this are stopped and fail the case. */
  scriptTimeoutMs: number;
}

export const DEFAULT_SUITE_OPTIONS: SuiteRunOptions = {
  mode: "sequential",
  concurrency: 5,
  delayMs: 0,
  repeat: 1,
  stopOnFailure: false,
  httpErrorsFail: true,
  scriptTimeoutMs: 5000,
};

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  cases: TestCase[];
  options: SuiteRunOptions;
  /** CSV data saved with the suite. Each row runs the whole suite once. */
  data?: SuiteData;
}

export interface SuiteData {
  name: string;
  text: string;
}

/** One pass/fail check: an assertion row or an rr.test() call in a script. */
export interface Check {
  name: string;
  passed: boolean;
  /** Why it failed, or what was seen. */
  message?: string;
  source: "assertion" | "pre-script" | "post-script" | "status";
}

export interface ScriptOutput {
  tests: { name: string; passed: boolean; error?: string }[];
  logs: string[];
  /** Run variables after the script finished. */
  vars: Vars;
  /** Set when the script threw or timed out. */
  error?: string;
  durationMs: number;
}

export interface CaseResult {
  /** 0-based iteration number across repeats and CSV rows. */
  iteration: number;
  /** 0-based CSV data row, or null when the suite has no CSV. */
  rowIndex: number | null;
  repeatIndex: number;
  caseId: string;
  caseName: string;
  /** Position of the case in the suite. */
  caseIndex: number;
  /** Variables the request was prepared with (environment, CSV row and run variables combined). */
  vars: Vars;
  /** Missing when the request was not sent (for example the pre-script failed). */
  outcome?: SendOutcome;
  preScript?: ScriptOutput;
  postScript?: ScriptOutput;
  checks: Check[];
  passed: boolean;
  notes: string[];
  startedAt: string;
  durationMs: number;
}

export type SuiteRunEnd = "completed" | "cancelled" | "stopped-on-failure";
