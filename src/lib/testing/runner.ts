import type { SendFn } from "../batch";
import { prepareRequest } from "../request";
import { combineScripts } from "../requestScripts";
import { findPlaceholders, type Vars } from "../template";
import { evaluateAssertion } from "./assertions";
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
  const times = Math.max(1, Math.floor(repeat) || 1);
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
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

function replaceVars(target: Vars, source: Vars): void {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
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

/** Runs one case: pre-script, request, assertions, post-script. Returns null when Stop cut the request off. */
export async function runCase(run: CaseRun, options: SuiteRunOptions, ctx: Omit<SuiteRunContext, "rows" | "onResult">): Promise<CaseResult | null> {
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
    preScript = await ctx.scripts(preCode, scriptCtx("pre"), options.scriptTimeoutMs);
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
    postScript = await ctx.scripts(postCode, c, options.scriptTimeoutMs);
    replaceVars(runVars, postScript.vars);
  }

  const assertions = tc.assertions.filter((a) => a.enabled);
  const assertVars = { ...ctx.envVars, ...iter.data, ...runVars };
  for (const a of assertions) checks.push(evaluateAssertion(a, outcome.response, assertVars));

  const status = outcome.response.status;
  const hasStatusAssertion = assertions.some((a) => a.source === "status");
  if (options.httpErrorsFail && !hasStatusAssertion) {
    checks.push({ name: "Status is below 400", passed: status < 400, message: `Got ${status}`, source: "status" });
  }
  checks.push(...scriptChecks(postScript, "post-script"));

  if (checks.length === 0) notes.push("This case has no assertions or tests, so it passes whenever a response comes back.");
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

/** Runs every enabled case for every iteration, in the order the run mode asks for. */
export async function runSuite(suite: TestSuite, ctx: SuiteRunContext): Promise<SuiteRunEnd> {
  const options = suite.options;
  const cases = suite.cases.map((testCase, caseIndex) => ({ testCase, caseIndex })).filter((c) => c.testCase.enabled);
  const iterations = planIterations(ctx.rows, options.repeat);
  let stopped = false;
  const shouldStop = () => ctx.signal.aborted || stopped;

  const runOne = async (c: (typeof cases)[number], iter: Iteration, runVars: Vars) => {
    const result = await runCase({ ...c, iter, runVars }, options, ctx);
    if (!result) return;
    if (!result.passed && options.stopOnFailure) stopped = true;
    ctx.onResult(result);
  };

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
        await chains[w](() => runOne(c, iter, { ...ctx.startVars }));
      });
    }
  } else {
    const concurrency = options.mode === "sequential" ? 1 : options.concurrency;
    const chains: ReturnType<typeof makeChain>[] = [];
    await pool(iterations, concurrency, shouldStop, async (iter, w) => {
      chains[w] ??= makeChain();
      // Variables carry from case to case within an iteration; each iteration starts from the same start values.
      const runVars: Vars = { ...ctx.startVars };
      for (const c of cases) {
        if (shouldStop()) break;
        await chains[w](() => runOne(c, iter, runVars));
      }
      ctx.onIterationDone?.(iter, runVars);
    });
  }

  if (ctx.signal.aborted) return "cancelled";
  if (stopped) return "stopped-on-failure";
  return "completed";
}
