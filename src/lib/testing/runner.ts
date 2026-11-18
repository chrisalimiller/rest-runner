import type { SendFn } from "../batch";
import { prepareRequest } from "../request";
import { combineScripts } from "../requestScripts";
import { findPlaceholders, type Vars } from "../template";
import { evaluateAssertionAsync } from "./assertions";
import { clampRepeat, splitCases, type CaseSlot } from "./plan";
import { replaceVars, retryNote, runWithRetry, sleep } from "./retry";
import type { ScriptContext } from "./sandbox";
import type { ScriptRunner } from "./scriptRunner";
import type { CaseResult, Check, ScriptOutput, SuiteRunEnd, SuiteRunOptions, TestCase, TestSuite } from "./types";

export interface Iteration {
  iteration: number;
  rowIndex: number | null;
  repeatIndex: number;
  data: Vars;
}

/** Repeats go round the whole data set: with 3 rows and repeat 2 the order is rows 1,2,3,1,2,3. */
export function planIterations(rows: Vars[] | null, repeat: number): Iteration[] {
  const times = clampRepeat(repeat);
  const data = rows && rows.length ? rows : null;
  const list: Iteration[] = [];
  for (let r = 0; r < times; r++) {
    if (data) data.forEach((row, i) => list.push({ iteration: list.length, rowIndex: i, repeatIndex: r, data: row }));
    else list.push({ iteration: list.length, rowIndex: null, repeatIndex: r, data: {} });
  }
  return list;
}

export interface SuiteRunContext {
  /** CSV data rows, or null to run the suite without data. */
  rows: Vars[] | null;
  envVars: Vars;
  send: SendFn;
  scripts: ScriptRunner;
  signal: AbortSignal;
  onResult: (result: CaseResult) => void;
  /** Variables each iteration starts with (a flow passes its variables in here). Empty when missing. */
  startVars?: Vars;
  /** Called with an iteration's variables once its cases are done. Not called in the parallel-cases mode. */
  onIterationDone?: (iteration: Iteration, runVars: Vars) => void;
}

/** Runs fn over items with at most `concurrency` at once. Stops handing out items once shouldStop() is true. */
async function pool<T>(
  items: T[],
  concurrency: number,
  shouldStop: () => boolean,
  fn: (item: T, worker: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const worker = async (_: unknown, w: number) => {
    while (!shouldStop() && next < items.length) await fn(items[next++], w);
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

function scriptChecks(output: ScriptOutput | undefined, source: "pre-script" | "post-script"): Check[] {
  if (!output) return [];
  const checks: Check[] = output.tests.map((t) => ({ name: t.name, passed: t.passed, message: t.error, source }));
  if (output.error) {
    checks.push({ name: source === "pre-script" ? "Pre-request script ran" : "Post-response script ran", passed: false, message: output.error, source });
  }
  return checks;
}

interface CaseRun {
  testCase: TestCase;
  caseIndex: number;
  iter: Iteration;
  /** Run variables for this iteration. Updated in place so later cases see changes. */
  runVars: Vars;
}

/**
 * Runs one case, trying again when the case has retries: each try starts from the run variables the case started with,
 * and the result is the last try. Returns null when Stop cut the request off.
 */
export async function runCase(run: CaseRun, options: SuiteRunOptions, ctx: Omit<SuiteRunContext, "rows" | "onResult">): Promise<CaseResult | null> {
  const retry = run.testCase.retry;
  if (!retry || retry.times <= 0) return runCaseOnce(run, options, ctx);
  const { last, attempts } = await runWithRetry(retry, run.runVars, ctx.signal, async () => {
    const result = await runCaseOnce(run, options, ctx);
    const failed = result?.checks.find((c) => !c.passed);
    return {
      result,
      passed: !!result?.passed,
      cancelled: !result,
      reason: result?.passed ? undefined : failed ? `${failed.name}${failed.message ? `: ${failed.message}` : ""}` : result?.notes[0],
    };
  });
  const result = last?.result;
  if (!result) return null;
  const note = retryNote(attempts, result.passed, retry.times);
  if (!note) return result;
  return { ...result, attempts, notes: [...result.notes, note] };
}

/** Runs one case once: pre-script, request, assertions, post-script. Returns null when Stop cut the request off. */
async function runCaseOnce(run: CaseRun, options: SuiteRunOptions, ctx: Omit<SuiteRunContext, "rows" | "onResult">): Promise<CaseResult | null> {
  const { testCase: tc, iter, runVars } = run;
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const notes: string[] = [];
  const def = tc.request;
  // A request's own scripts run first, then the case's, so a request behaves the same here as in Requests.
  const preCode = combineScripts(def.preScript, tc.preScript);
  const postCode = combineScripts(def.postScript, tc.postScript);
  const scriptCtx = (phase: "pre" | "post"): ScriptContext => ({
    phase,
    vars: { ...runVars },
    data: iter.data,
    env: ctx.envVars,
    iteration: iter.iteration,
    caseName: tc.name,
    request: {
      method: def.method,
      url: def.url,
      headers: def.headers.filter((h) => h.enabled && h.key.trim() !== "").map((h) => [h.key, h.value] as [string, string]),
      body: def.bodyMode === "none" ? undefined : def.body,
    },
  });
  const base = {
    iteration: iter.iteration,
    rowIndex: iter.rowIndex,
    repeatIndex: iter.repeatIndex,
    caseId: tc.id,
    caseName: tc.name,
    caseIndex: run.caseIndex,
    startedAt,
  };

  let preScript: ScriptOutput | undefined;
  if (preCode.trim() !== "") {
    preScript = await ctx.scripts(preCode, scriptCtx("pre"), options.scriptTimeoutMs, ctx.signal);
    replaceVars(runVars, preScript.vars);
    if (preScript.error) {
      notes.push(`Pre-request script failed, so the request was not sent: ${preScript.error}`);
      return {
        ...base,
        vars: { ...ctx.envVars, ...iter.data, ...runVars },
        preScript,
        checks: scriptChecks(preScript, "pre-script"),
        passed: false,
        notes,
        durationMs: Date.now() - start,
      };
    }
  }

  const vars = { ...ctx.envVars, ...iter.data, ...runVars };
  const prepared = prepareRequest(def, vars);
  const outcome = await ctx.send(prepared, ctx.signal);
  if (ctx.signal.aborted && !outcome.ok) return null;

  const unfilled = new Set([
    ...findPlaceholders(prepared.url),
    ...prepared.headers.flatMap(([k, v]) => [...findPlaceholders(k), ...findPlaceholders(v)]),
    ...findPlaceholders(prepared.body ?? ""),
  ]);
  if (unfilled.size) notes.push(`Placeholders with no value were sent as written: ${[...unfilled].map((n) => `{{${n}}}`).join(", ")}.`);

  const checks: Check[] = scriptChecks(preScript, "pre-script");
  if (!outcome.ok) {
    checks.push({ name: "Response received", passed: false, message: outcome.error, source: "status" });
    notes.push(`No response: ${outcome.error}. Assertions and the post-response script were skipped.`);
    return { ...base, vars, outcome, preScript, checks, passed: false, notes, durationMs: Date.now() - start };
  }

  let postScript: ScriptOutput | undefined;
  if (postCode.trim() !== "") {
    const c = scriptCtx("post");
    c.request = { method: prepared.method, url: prepared.url, headers: prepared.headers, body: prepared.body };
    c.response = outcome.response;
    postScript = await ctx.scripts(postCode, c, options.scriptTimeoutMs, ctx.signal);
    replaceVars(runVars, postScript.vars);
  }

  const assertions = tc.assertions.filter((a) => a.enabled);
  const assertVars = { ...ctx.envVars, ...iter.data, ...runVars };
  for (const a of assertions) {
    checks.push(await evaluateAssertionAsync(a, outcome.response, assertVars, ctx.signal));
    if (ctx.signal.aborted) return null;
  }

  const status = outcome.response.status;
  const hasStatusAssertion = assertions.some((a) => a.source === "status");
  const implicitStatus = options.httpErrorsFail && !hasStatusAssertion;
  if (implicitStatus) {
    checks.push({ name: "Status is below 400", passed: status < 400, message: `Got ${status}`, source: "status" });
  }
  checks.push(...scriptChecks(postScript, "post-script"));

  // The implicit status check is not one of the case's own checks.
  if (checks.length === (implicitStatus ? 1 : 0)) {
    notes.push(
      implicitStatus
        ? "This case has no assertions or tests, so it passes whenever a response comes back with a status below 400."
        : "This case has no assertions or tests, so it passes whenever a response comes back.",
    );
  }
  if (status >= 400 && hasStatusAssertion) notes.push(`HTTP ${status} was judged by the case's own status assertion.`);
  if (status >= 400 && !options.httpErrorsFail && !hasStatusAssertion) notes.push(`HTTP ${status} not counted as a failure ("4xx/5xx fail the case" was off).`);

  return {
    ...base,
    vars,
    outcome,
    preScript,
    postScript,
    checks,
    passed: checks.every((c) => c.passed),
    notes,
    durationMs: Date.now() - start,
  };
}

/** The iteration a setup or teardown case runs in: no CSV row of its own, sorted before (-1) or after all the others. */
function phaseIteration(phase: "before" | "after", rows: Vars[] | null, iterations: number): Iteration {
  return { iteration: phase === "before" ? -1 : iterations, rowIndex: null, repeatIndex: 0, data: rows && rows.length ? rows[0] : {} };
}

/** Runs every enabled case for every iteration, in the order the run mode asks for. */
export async function runSuite(suite: TestSuite, ctx: SuiteRunContext): Promise<SuiteRunEnd> {
  const options = suite.options;
  const { before, each: cases, after } = splitCases(suite.cases, true);
  const iterations = planIterations(ctx.rows, options.repeat);
  let stopped = false;
  const shouldStop = () => ctx.signal.aborted || stopped;

  const runOne = async (c: CaseSlot, iter: Iteration, runVars: Vars) => {
    const result = await runCase({ ...c, iter, runVars }, options, ctx);
    if (!result) return;
    if (!result.passed && options.stopOnFailure) stopped = true;
    ctx.onResult(result);
  };

  /** Setup or teardown: once, in suite order, one at a time. Returns false when a case failed or Stop was pressed. */
  const runOnce = async (slots: CaseSlot[], phase: "before" | "after", runVars: Vars): Promise<boolean> => {
    const iter = phaseIteration(phase, ctx.rows, iterations.length);
    let ok = true;
    for (const c of slots) {
      if (ctx.signal.aborted) return false;
      const result = await runCase({ ...c, iter, runVars }, options, ctx);
      if (!result) return false;
      ctx.onResult({ ...result, phase });
      if (!result.passed) ok = false;
      if (!ok && phase === "before") return false;
    }
    return ok;
  };

  // Setup runs first. What it sets is what every iteration (and teardown) starts with.
  const startVars: Vars = { ...ctx.startVars };
  if (before.length) {
    const ok = await runOnce(before, "before", startVars);
    if (ctx.signal.aborted) return "cancelled";
    if (!ok) return "stopped-on-failure";
  }
  const setupVars: Vars = { ...startVars };

  /** A worker's chain of cases, pausing between them when a delay is set. */
  const makeChain = () => {
    let first = true;
    return async (fn: () => Promise<void>) => {
      if (!first) await sleep(options.delayMs, ctx.signal);
      first = false;
      if (!shouldStop()) await fn();
    };
  };

  if (options.mode === "parallel-cases") {
    for (const iter of iterations) {
      if (shouldStop()) break;
      const chains: ReturnType<typeof makeChain>[] = [];
      await pool(cases, options.concurrency, shouldStop, async (c, w) => {
        chains[w] ??= makeChain();
        // Cases running at the same time cannot pass variables to each other, so each starts from the start values.
        await chains[w](() => runOne(c, iter, { ...setupVars }));
      });
    }
  } else {
    const concurrency = options.mode === "sequential" ? 1 : options.concurrency;
    const chains: ReturnType<typeof makeChain>[] = [];
    await pool(iterations, concurrency, shouldStop, async (iter, w) => {
      chains[w] ??= makeChain();
      // Variables carry from case to case within an iteration; each iteration starts from the same start values.
      const runVars: Vars = { ...setupVars };
      for (const c of cases) {
        if (shouldStop()) break;
        await chains[w](() => runOne(c, iter, runVars));
      }
      ctx.onIterationDone?.(iter, runVars);
    });
  }

  // Teardown runs even when rows failed (and after "stop on first failure"), but not after Stop.
  if (!ctx.signal.aborted && after.length) await runOnce(after, "after", { ...setupVars });

  if (ctx.signal.aborted) return "cancelled";
  if (stopped) return "stopped-on-failure";
  return "completed";
}

/**
 * "Try up to here": runs the cases from the first through `upToIndex` once, in order, using the first CSV row.
 * Disabled cases are skipped (the target case runs even when it is off, since it was asked for), and variables
 * carry from case to case like in a sequential run. Stops at the first failure when the suite says so.
 */
export async function runUpTo(suite: TestSuite, upToIndex: number, ctx: Omit<SuiteRunContext, "onResult"> & { onResult?: (result: CaseResult) => void }): Promise<CaseResult[]> {
  const iter = planIterations(ctx.rows, 1)[0];
  const runVars: Vars = { ...ctx.startVars };
  const results: CaseResult[] = [];
  // The order the runbook shows: setup, then the normal list, then teardown.
  const { before, each, after } = splitCases(suite.cases);
  const order = [...before, ...each, ...after];
  const last = order.findIndex((c) => c.caseIndex === upToIndex);
  for (let pos = 0; pos <= last; pos++) {
    const { testCase: tc, caseIndex } = order[pos];
    if (!tc.enabled && caseIndex !== upToIndex) continue;
    if (ctx.signal.aborted) break;
    const phase = tc.runs === "before" || tc.runs === "after" ? tc.runs : undefined;
    const result = await runCase({ testCase: tc, caseIndex, iter: phase ? phaseIteration(phase, ctx.rows, 1) : iter, runVars }, suite.options, ctx);
    if (!result) break;
    const done = phase ? { ...result, phase } : result;
    results.push(done);
    ctx.onResult?.(done);
    if (!result.passed && (suite.options.stopOnFailure || phase === "before")) break;
  }
  return results;
}
