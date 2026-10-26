import type { SendFn } from "../batch";
import { parseCsv } from "../csv";
import { newId } from "../ids";
import { applyTemplate, type Vars } from "../template";
import { planIterations, runCase, runSuite } from "../testing/runner";
import type { ScriptRunner } from "../testing/scriptRunner";
import { buildTestRun, type TestRun } from "../testing/testRun";
import { DEFAULT_SUITE_OPTIONS, type CaseResult, type SuiteRunEnd, type TestCase, type TestSuite } from "../testing/types";
import type { RequestDef, ResponseResult } from "../types";
import { evaluateCondition } from "./conditions";
import { formatMs, nodeLabel, type RequestLookup } from "./flows";
import { describeSchedule } from "./schedule";
import { hasErrors, validateFlow } from "./validate";
import type { Attempt, Flow, FlowNode, FlowOutput, FlowRun, FlowRunEnd, FlowStep, RunNode } from "./types";

/** A flow that keeps going round a loop stops after this many steps. */
export const MAX_FLOW_STEPS = 1000;

/**
 * A saved request runs as a one-off case with no assertions, so it passes when a
 * response comes back and every rr.test in its scripts passes. A 4xx/5xx alone does not fail it.
 */

export interface FlowRunContext {
  /** The suites as they are now. Run nodes point at them by id. */
  suites: TestSuite[];
  findRequest: RequestLookup;
  envVars: Vars;
  environmentName?: string;
  send: SendFn;
  scripts: ScriptRunner;
  signal: AbortSignal;
  /** The node to start from. Missing means the Start node. */
  entryNodeId?: string;
  /** "manual", or the id of the Schedule step that started the run. */
  trigger?: string;
  maxSteps?: number;
  /** Called when a step starts, before it has a result. */
  onStepStart?: (nodeId: string, index: number) => void;
  /** Called with each finished step. */
  onStep?: (step: FlowStep) => void;
}

export class FlowNotRunnableError extends Error {}

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


function replaceVars(target: Vars, source: Vars): void {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
}

function firstFailure(results: CaseResult[], end: SuiteRunEnd): string | undefined {
  const failed = results.find((r) => !r.passed);
  if (failed) {
    const check = failed.checks.find((c) => !c.passed);
    const why = check ? `${check.name}${check.message ? `: ${check.message}` : ""}` : (failed.notes[0] ?? "failed");
    return `"${failed.caseName}" failed (${why})`;
  }
  if (end === "cancelled") return "Stopped";
  if (results.length === 0) return "No case ran";
  return undefined;
}

/** What one try of a Run step produced. */
interface TryResult {
  passed: boolean;
  cancelled: boolean;
  child: TestRun;
  lastResponse: ResponseResult | null;
  reason?: string;
}

/**
 * One line of execution. The flow starts with one; each Parallel branch gets its own
 * copy, and a Loop over CSV fills `data` from the current row.
 */
interface Lane {
  vars: Vars;
  /** Values of the current CSV row (and of outer loops' rows), for {{column}} placeholders. */
  data: Vars;
  lastResult: "passed" | "failed" | null;
  lastResponse: ResponseResult | null;
  branch: string;
  row?: number;
}

interface Engine {
  flow: Flow;
  ctx: FlowRunContext;
  suites: TestSuite[];
  byId: Map<string, FlowNode>;
  steps: FlowStep[];
  log: FlowRun["log"];
  maxSteps: number;
}

/** How a walk along the wires ended. */
type WalkEnd =
  /** Reached an output with no wire. `failed` when it was a failed output. */
  | { kind: "end"; failed: boolean; reason?: string }
  /** Reached a Join while inside a Parallel branch. */
  | { kind: "join"; joinId: string }
  /** Wired back into the Loop over CSV it runs inside. */
  | { kind: "loop-back" }
  | { kind: "cancelled" }
  | { kind: "error"; reason: string };

interface WalkContext {
  inParallel: boolean;
  loopId?: string;
}

function lastResponseOf(results: CaseResult[]): ResponseResult | null {
  const sorted = [...results].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const o = sorted[i].outcome;
    if (o?.ok) return o.response;
  }
  return null;
}

/** Runs one case (a suite's case, or a saved request wrapped as one) against the lane's variables. */
async function tryCase(e: Engine, lane: Lane, suite: TestSuite, tc: TestCase): Promise<TryResult> {
  const startedAt = new Date().toISOString();
  const result = await runCase(
    { testCase: tc, caseIndex: 0, iter: { iteration: lane.row ?? 0, rowIndex: lane.row ?? null, repeatIndex: 0, data: lane.data }, runVars: lane.vars },
    suite.options,
    { envVars: e.ctx.envVars, send: e.ctx.send, scripts: e.ctx.scripts, signal: e.ctx.signal },
  );
  const results = result ? [result] : [];
  const end: SuiteRunEnd = result ? "completed" : "cancelled";
  const child = buildTestRun({
    id: newId(),
    suite: { ...suite, cases: [tc] },
    columns: Object.keys(lane.data),
    iterations: 1,
    environmentName: e.ctx.environmentName,
    startedAt,
    finishedAt: new Date().toISOString(),
    end,
    results,
  });
  return {
    passed: !!result?.passed,
    cancelled: !result,
    child,
    lastResponse: lastResponseOf(results),
    reason: result?.passed ? undefined : firstFailure(results, end),
  };
}

async function trySuite(e: Engine, lane: Lane, suite: TestSuite): Promise<TryResult> {
  const startedAt = new Date().toISOString();
  const csv = suite.data ? parseCsv(suite.data.text) : null;
  const rows = csv ? csv.rows : null;
  const results: CaseResult[] = [];
  let finalVars: Vars | null = null;
  const end = await runSuite(suite, {
    rows,
    // A loop row's values sit under the suite's own CSV row.
    envVars: { ...e.ctx.envVars, ...lane.data },
    send: e.ctx.send,
    scripts: e.ctx.scripts,
    signal: e.ctx.signal,
    startVars: { ...lane.vars },
    onResult: (r) => results.push(r),
    // With several iterations, the one that finished last decides what later steps see.
    onIterationDone: (_iter, runVars) => {
      finalVars = { ...runVars };
    },
  });
  if (finalVars) replaceVars(lane.vars, finalVars);
  const child = buildTestRun({
    id: newId(),
    suite,
    csvName: suite.data?.name,
    columns: csv?.headers ?? [],
    iterations: planIterations(rows, suite.options.repeat).length,
    environmentName: e.ctx.environmentName,
    startedAt,
    finishedAt: new Date().toISOString(),
    end,
    results,
  });
  const passed = end === "completed" && results.length > 0 && results.every((r) => r.passed);
  return { passed, cancelled: end === "cancelled", child, lastResponse: lastResponseOf(results), reason: passed ? undefined : firstFailure(results, end) };
}

/** A saved request as a case with no assertions or scripts of its own; the request's own scripts still run. */
function requestCase(def: RequestDef): TestCase {
  return { id: def.id, name: def.name, enabled: true, request: structuredClone(def), preScript: "", postScript: "", assertions: [] };
}

function requestSuite(def: RequestDef, tc: TestCase, httpErrorsFail: boolean): TestSuite {
  return { id: `request:${def.id}`, name: def.name, description: "Saved request run by a flow", cases: [tc], options: { ...DEFAULT_SUITE_OPTIONS, httpErrorsFail } };
}

async function tryRunNode(e: Engine, lane: Lane, node: RunNode): Promise<TryResult> {
  if (node.type === "run-suite") {
    const suite = e.suites.find((s) => s.id === node.suiteId)!;
    return trySuite(e, lane, suite);
  }
  if (node.type === "run-case") {
    const suite = e.suites.find((s) => s.id === node.suiteId)!;
    const tc = suite.cases.find((c) => c.id === node.caseId)!;
    return tryCase(e, lane, suite, tc);
  }
  const def = e.ctx.findRequest(node.requestId)!;
  const tc = requestCase(def);
  // A 4xx/5xx fails the step unless the step's switch was turned off. Older flows have no switch and count as on.
  return tryCase(e, lane, requestSuite(def, tc, node.httpErrorsFail !== false), tc);
}

interface StepOutcome {
  status: FlowStep["status"];
  output?: FlowOutput;
  notes: string[];
  attempts?: Attempt[];
  child?: TestRun;
  check?: FlowStep["check"];
}

/** Variables for {{placeholders}} outside requests: environment, then the loop row, then flow variables. */
function templateVars(e: Engine, lane: Lane): Vars {
  return { ...e.ctx.envVars, ...lane.data, ...lane.vars };
}

/** Runs a node that does its work in one go (everything except Parallel, Join and Loop over CSV). */
async function runSimpleNode(e: Engine, lane: Lane, node: FlowNode): Promise<StepOutcome> {
  switch (node.type) {
    case "start":
      return { status: "done", output: "next", notes: [] };
    case "schedule":
      return { status: "done", output: "next", notes: [e.ctx.trigger === node.id ? `Started by its schedule: ${describeSchedule(node.schedule)}.` : "Started from here."] };
    case "note":
    case "parallel":
    case "join":
    case "loop":
      return { status: "done", notes: [] };
    case "wait": {
      await sleep(node.ms, e.ctx.signal);
      if (e.ctx.signal.aborted) return { status: "cancelled", notes: ["Stopped while waiting."] };
      return { status: "done", output: "next", notes: [`Waited ${formatMs(node.ms)}.`] };
    }
    case "set-var": {
      const name = node.name.trim();
      const value = applyTemplate(node.value, templateVars(e, lane));
      lane.vars[name] = value;
      return { status: "done", output: "next", notes: [`Set ${name} to ${JSON.stringify(value)}.`] };
    }
    case "if": {
      const check = evaluateCondition(node.condition, { vars: templateVars(e, lane), lastResult: lane.lastResult, lastResponse: lane.lastResponse });
      return {
        status: "done",
        output: check.passed ? "true" : "false",
        notes: [`${check.name}: ${check.passed}${check.message ? ` (${check.message})` : ""}.`],
        check,
      };
    }
    case "run-case":
    case "run-suite":
    case "run-request": {
      const attempts: Attempt[] = [];
      const before = { ...lane.vars };
      const notes: string[] = [];
      let last: TryResult | null = null;
      for (let i = 0; i <= node.retry.times; i++) {
        if (i > 0) {
          await sleep(node.retry.delayMs, e.ctx.signal);
          if (e.ctx.signal.aborted) break;
          // Each try starts from the variables the step started with.
          replaceVars(lane.vars, before);
        }
        const start = Date.now();
        const startedAt = new Date(start).toISOString();
        last = await tryRunNode(e, lane, node);
        if (last.cancelled) break;
        attempts.push({ passed: last.passed, startedAt, durationMs: Date.now() - start, reason: last.reason });
        if (last.passed) break;
      }
      if (e.ctx.signal.aborted || !last || last.cancelled) {
        return { status: "cancelled", notes: ["Stopped before this step finished."], attempts, child: last?.child };
      }
      if (attempts.length > 1) {
        notes.push(last.passed ? `Passed on try ${attempts.length} of ${node.retry.times + 1}.` : `Failed all ${attempts.length} tries.`);
      }
      if (!last.passed && last.reason) notes.push(last.reason + ".");
      lane.lastResult = last.passed ? "passed" : "failed";
      lane.lastResponse = last.lastResponse;
      return { status: last.passed ? "passed" : "failed", output: last.passed ? "passed" : "failed", notes, attempts, child: last.child };
    }
  }
}

/** Starts a step: reserves its place in the run so steps stay in the order they started. */
function beginStep(e: Engine, lane: Lane, node: FlowNode): FlowStep {
  const step: FlowStep = {
    index: e.steps.length,
    ...(lane.branch ? { branch: lane.branch } : {}),
    ...(lane.row !== undefined ? { row: lane.row } : {}),
    nodeId: node.id,
    nodeType: node.type,
    label: nodeLabel(node, e.suites, e.ctx.findRequest),
    status: "done",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    varsBefore: { ...lane.vars },
    varsAfter: {},
    notes: [],
  };
  e.steps.push(step);
  e.ctx.onStepStart?.(node.id, step.index);
  return step;
}

/** Finishes a step with its outcome and works out which wire it leaves by. */
function endStep(e: Engine, lane: Lane, step: FlowStep, outcome: StepOutcome): string | undefined {
  const wire = outcome.output ? e.flow.edges.find((w) => w.source === step.nodeId && w.sourceHandle === outcome.output) : undefined;
  Object.assign(step, {
    status: outcome.status,
    output: outcome.output,
    nextNodeId: outcome.output ? (wire?.target ?? null) : undefined,
    durationMs: Date.now() - Date.parse(step.startedAt),
    varsAfter: { ...lane.vars },
    notes: outcome.notes,
    attempts: outcome.attempts,
    child: outcome.child,
    check: outcome.check,
  } satisfies Partial<FlowStep>);
  for (const k of ["attempts", "child", "check"] as const) if (step[k] === undefined) delete step[k];
  e.ctx.onStep?.(step);
  return wire?.target;
}

function where(lane: Lane): string {
  const parts = [];
  if (lane.branch) parts.push(`branch ${lane.branch}`);
  if (lane.row !== undefined) parts.push(`row ${lane.row + 1}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** Merges branch variables into the lane: branches are applied in the order they finished, so the last one wins. */
function mergeBranches(lane: Lane, finished: Lane[]): void {
  for (const b of finished) Object.assign(lane.vars, b.vars);
  const last = finished[finished.length - 1];
  if (last) lane.lastResponse = last.lastResponse ?? lane.lastResponse;
}

/** Runs every branch of a Parallel at once, then the Join they meet at. Returns where to go next, or how the walk ended. */
async function runParallel(e: Engine, lane: Lane, node: FlowNode, wc: WalkContext): Promise<{ next?: string; end?: WalkEnd }> {
  const step = beginStep(e, lane, node);
  const targets = e.flow.edges.filter((w) => w.source === node.id && w.sourceHandle === "branches").map((w) => w.target);
  endStep(e, lane, step, { status: "done", output: "branches", notes: [targets.length ? `Started ${targets.length} branch${targets.length === 1 ? "" : "es"} at once.` : "No branches are wired."] });
  step.nextNodeId = targets[0] ?? null;
  if (targets.length === 0) return { end: { kind: "end", failed: false } };

  const finishOrder: number[] = [];
  const lanes: Lane[] = targets.map((_, i) => ({ ...lane, vars: { ...lane.vars }, branch: lane.branch ? `${lane.branch}.${i + 1}` : String(i + 1) }));
  const ends = await Promise.all(
    targets.map((t, i) =>
      walk(e, t, lanes[i], { inParallel: true, loopId: wc.loopId }).then((end) => {
        finishOrder.push(i);
        return end;
      }),
    ),
  );

  if (ends.some((x) => x.kind === "cancelled")) return { end: { kind: "cancelled" } };
  const error = ends.find((x): x is Extract<WalkEnd, { kind: "error" }> => x.kind === "error");
  if (error) return { end: error };

  const label = step.label;
  const joins = [...new Set(ends.flatMap((x) => (x.kind === "join" ? [x.joinId] : [])))];
  if (joins.length > 1) return { end: { kind: "error", reason: `The branches of "${label}" meet at different Join steps. Wire every branch to the same Join.` } };

  const failedBranches = ends.flatMap((x, i) => (x.kind === "end" && x.failed ? [{ i, reason: x.reason }] : []));
  mergeBranches(
    lane,
    finishOrder.map((i) => lanes[i]),
  );

  if (joins.length === 0) {
    // No Join: the flow ends once every branch has finished.
    if (failedBranches.length) return { end: { kind: "end", failed: true, reason: failedBranches[0].reason } };
    return { end: { kind: "end", failed: false } };
  }

  const join = e.byId.get(joins[0])!;
  const joinStep = beginStep(e, lane, join);
  const failed = failedBranches.length > 0;
  lane.lastResult = failed ? "failed" : "passed";
  const notes = [`All ${targets.length} branches finished${failed ? `; ${failedBranches.length} failed` : ""}.`];
  for (const f of failedBranches) notes.push(`Branch ${lanes[f.i].branch}: ${f.reason ?? "failed"}`);
  const next = endStep(e, lane, joinStep, { status: failed ? "failed" : "passed", output: failed ? "failed" : "passed", notes });
  if (failed && !next) {
    return { end: { kind: "end", failed: true, reason: `"${joinStep.label}" failed because a branch failed, and nothing is wired to its failed output.` } };
  }
  if (failed) e.log.push({ at: joinStep.startedAt, message: `"${joinStep.label}" failed; following its failed wire.` });
  return next ? { next } : { end: { kind: "end", failed: false } };
}

/** Runs the steps wired to "each row" once per CSV row, then leaves by "done". */
async function runLoop(e: Engine, lane: Lane, node: Extract<FlowNode, { type: "loop" }>): Promise<{ next?: string; end?: WalkEnd }> {
  const step = beginStep(e, lane, node);
  const rows = node.data ? parseCsv(node.data.text).rows : [];
  const body = e.flow.edges.find((w) => w.source === node.id && w.sourceHandle === "row")?.target;
  const outer = { data: lane.data, row: lane.row };
  const failedRows: { row: number; reason?: string }[] = [];
  let end: WalkEnd | null = null;

  if (body) {
    for (let i = 0; i < rows.length; i++) {
      if (e.ctx.signal.aborted) {
        end = { kind: "cancelled" };
        break;
      }
      lane.data = { ...outer.data, ...rows[i] };
      lane.row = i;
      const r = await walk(e, body, lane, { inParallel: false, loopId: node.id });
      if (r.kind === "cancelled" || r.kind === "error") {
        end = r;
        break;
      }
      if (r.kind === "end" && r.failed) failedRows.push({ row: i, reason: r.reason });
    }
  }
  lane.data = outer.data;
  lane.row = outer.row;

  const notes = [
    !node.data ? "No CSV loaded." : `${rows.length} row${rows.length === 1 ? "" : "s"} in ${node.data.name}.`,
    body ? `${rows.length - failedRows.length} row${rows.length - failedRows.length === 1 ? "" : "s"} passed, ${failedRows.length} failed.` : 'Nothing is wired to "each row".',
    ...failedRows.map((f) => `Row ${f.row + 1}: ${f.reason ?? "failed"}`),
  ];
  if (end) {
    endStep(e, lane, step, { status: "cancelled", notes });
    return { end };
  }
  const failed = failedRows.length > 0;
  const next = endStep(e, lane, step, { status: failed ? "failed" : "passed", output: "done", notes });
  if (failed) {
    // Every row has run; a failed row now stops the flow (or this branch).
    step.nextNodeId = null;
    return { end: { kind: "end", failed: true, reason: `${failedRows.length} of ${rows.length} rows of "${step.label}" failed.` } };
  }
  return next ? { next } : { end: { kind: "end", failed: false } };
}

/** Follows the wires from a node until the walk ends. */
async function walk(e: Engine, startId: string, lane: Lane, wc: WalkContext): Promise<WalkEnd> {
  let current: string | undefined = startId;
  while (current) {
    if (e.ctx.signal.aborted) return { kind: "cancelled" };
    if (e.steps.length >= e.maxSteps) return { kind: "error", reason: `Stopped after ${e.maxSteps} steps. Check for a loop that never ends.` };
    const node = e.byId.get(current);
    if (!node) return { kind: "error", reason: "A wire points at a step that no longer exists." };
    if (wc.loopId && node.id === wc.loopId) return { kind: "loop-back" };
    if (node.type === "join" && wc.inParallel) return { kind: "join", joinId: node.id };

    if (node.type === "parallel" || node.type === "loop") {
      const r = node.type === "parallel" ? await runParallel(e, lane, node, wc) : await runLoop(e, lane, node);
      if (r.end) return r.end;
      current = r.next;
      continue;
    }

    const step = beginStep(e, lane, node);
    const outcome =
      node.type === "join"
        ? // A Join reached outside a Parallel has one path coming in, so it just passes through.
          ({ status: "passed", output: "passed", notes: ["Only one path reached this Join, so it passed straight through."] } satisfies StepOutcome)
        : await runSimpleNode(e, lane, node);
    const next = endStep(e, lane, step, outcome);
    if (outcome.status === "cancelled") return { kind: "cancelled" };
    if (outcome.status === "failed" && !next) {
      return { kind: "end", failed: true, reason: `"${step.label}"${where(lane)} failed and nothing is wired to its failed output.` };
    }
    if (outcome.status === "failed") e.log.push({ at: step.startedAt, message: `"${step.label}"${where(lane)} failed; following its failed wire.` });
    current = next;
  }
  return { kind: "end", failed: false };
}

/**
 * Runs a flow from its Start node (or ctx.entryNodeId), following the wire for each
 * step's output. The run ends when an output has no wire. A failed step with no wire on
 * its failed output stops the flow (or its parallel branch) and marks it failed.
 *
 * Throws FlowNotRunnableError when the flow has errors (see validateFlow).
 */
export async function runFlow(flow: Flow, ctx: FlowRunContext): Promise<FlowRun> {
  const problems = validateFlow(flow, ctx.suites, ctx.findRequest, { entryNodeId: ctx.entryNodeId });
  if (hasErrors(problems)) {
    throw new FlowNotRunnableError(
      problems
        .filter((p) => p.level === "error")
        .map((p) => p.message)
        .join(" "),
    );
  }

  const snapshot = structuredClone(flow);
  const startedAt = new Date().toISOString();
  const e: Engine = {
    flow: snapshot,
    ctx,
    suites: structuredClone(ctx.suites),
    byId: new Map(snapshot.nodes.map((n) => [n.id, n])),
    steps: [],
    log: [
      { at: startedAt, message: `Started flow "${snapshot.name}".` },
      { at: startedAt, message: ctx.environmentName ? `Environment: ${ctx.environmentName}.` : "No environment selected." },
    ],
    maxSteps: ctx.maxSteps ?? MAX_FLOW_STEPS,
  };
  const lane: Lane = { vars: {}, data: {}, lastResult: null, lastResponse: null, branch: "" };
  const entry = ctx.entryNodeId ?? (snapshot.nodes.find((n) => n.type === "start") ?? snapshot.nodes.find((n) => n.type === "schedule"))!.id;
  const result = await walk(e, entry, lane, { inParallel: false });

  let end: FlowRunEnd = "passed";
  let endReason: string | undefined;
  if (result.kind === "cancelled" || ctx.signal.aborted) {
    end = "cancelled";
    endReason = "Stopped by you.";
  } else if (result.kind === "error") {
    end = "failed";
    endReason = result.reason;
  } else if (result.kind === "end" && result.failed) {
    end = "failed";
    endReason = result.reason;
  }

  const finishedAt = new Date().toISOString();
  const runSteps = e.steps.filter((s) => s.attempts);
  // The flow got to its end, but only because failed Run steps had a failed wire to follow.
  if (end === "passed" && runSteps.some((s) => s.status === "failed")) end = "passed-handled";
  const passedSteps = runSteps.filter((s) => s.status === "passed").length;
  const failedSteps = runSteps.filter((s) => s.status === "failed").length;
  e.log.push({ at: finishedAt, message: endReason ?? "Reached the end of the flow." });
  e.log.push({
    at: finishedAt,
    message: `Finished ${end}: ${e.steps.length} step${e.steps.length === 1 ? "" : "s"}, ${passedSteps} run step${passedSteps === 1 ? "" : "s"} passed, ${failedSteps} failed.`,
  });

  return {
    id: newId(),
    kind: "flow",
    flowId: snapshot.id,
    flowName: snapshot.name,
    environmentName: ctx.environmentName,
    trigger: ctx.trigger ?? "manual",
    ...(ctx.trigger && ctx.trigger !== "manual" && e.byId.get(ctx.trigger)?.type === "schedule"
      ? { triggerLabel: describeSchedule((e.byId.get(ctx.trigger) as Extract<FlowNode, { type: "schedule" }>).schedule) }
      : {}),
    startedAt,
    finishedAt,
    end,
    endReason,
    steps: e.steps.length,
    passedSteps,
    failedSteps,
    flow: snapshot,
    stepList: e.steps,
    vars: { ...lane.vars },
    log: e.log,
  };
}
