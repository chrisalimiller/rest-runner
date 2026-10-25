import type { SendFn } from "../batch";
import { parseCsv } from "../csv";
import { newId } from "../ids";
import { applyTemplate, type Vars } from "../template";
import { planIterations, runCase, runSuite } from "../testing/runner";
import type { ScriptRunner } from "../testing/scriptRunner";
import { buildTestRun, type TestRun } from "../testing/testRun";
import { DEFAULT_SUITE_OPTIONS, type CaseResult, type SuiteRunEnd, type SuiteRunOptions, type TestCase, type TestSuite } from "../testing/types";
import type { RequestDef, ResponseResult } from "../types";
import { evaluateCondition } from "./conditions";
import { formatMs, nodeLabel, type RequestLookup } from "./flows";
import { hasErrors, validateFlow } from "./validate";
import type { Attempt, Flow, FlowNode, FlowOutput, FlowRun, FlowRunEnd, FlowStep, RunNode } from "./types";

/** A flow that keeps going round a loop stops after this many steps. */
export const MAX_FLOW_STEPS = 1000;

/**
 * A saved request runs as a one-off case with no assertions, so it passes when a
 * response comes back and every rr.test in its scripts passes. A 4xx/5xx alone does not fail it.
 */
export const REQUEST_STEP_OPTIONS: SuiteRunOptions = { ...DEFAULT_SUITE_OPTIONS, httpErrorsFail: false };

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
  /** "manual", or the id of what started the run. */
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

interface Engine {
  flow: Flow;
  ctx: FlowRunContext;
  suites: TestSuite[];
  vars: Vars;
  lastResult: "passed" | "failed" | null;
  lastResponse: ResponseResult | null;
}

function lastResponseOf(results: CaseResult[]): ResponseResult | null {
  const sorted = [...results].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const o = sorted[i].outcome;
    if (o?.ok) return o.response;
  }
  return null;
}

/** Runs one case (a suite's case, or a saved request wrapped as one) against the flow variables. */
async function tryCase(e: Engine, suite: TestSuite, tc: TestCase): Promise<TryResult> {
  const startedAt = new Date().toISOString();
  const result = await runCase(
    { testCase: tc, caseIndex: 0, iter: { iteration: 0, rowIndex: null, repeatIndex: 0, data: {} }, runVars: e.vars },
    suite.options,
    { envVars: e.ctx.envVars, send: e.ctx.send, scripts: e.ctx.scripts, signal: e.ctx.signal },
  );
  const results = result ? [result] : [];
  const end: SuiteRunEnd = result ? "completed" : "cancelled";
  const child = buildTestRun({
    id: newId(),
    suite: { ...suite, cases: [tc] },
    columns: [],
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

async function trySuite(e: Engine, suite: TestSuite): Promise<TryResult> {
  const startedAt = new Date().toISOString();
  const csv = suite.data ? parseCsv(suite.data.text) : null;
  const rows = csv ? csv.rows : null;
  const results: CaseResult[] = [];
  let finalVars: Vars | null = null;
  const end = await runSuite(suite, {
    rows,
    envVars: e.ctx.envVars,
    send: e.ctx.send,
    scripts: e.ctx.scripts,
    signal: e.ctx.signal,
    startVars: { ...e.vars },
    onResult: (r) => results.push(r),
    // With several iterations, the one that finished last decides what later steps see.
    onIterationDone: (_iter, runVars) => {
      finalVars = { ...runVars };
    },
  });
  if (finalVars) replaceVars(e.vars, finalVars);
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

function requestSuite(def: RequestDef, tc: TestCase): TestSuite {
  return { id: `request:${def.id}`, name: def.name, description: "Saved request run by a flow", cases: [tc], options: { ...REQUEST_STEP_OPTIONS } };
}

async function tryRunNode(e: Engine, node: RunNode): Promise<TryResult> {
  if (node.type === "run-suite") {
    const suite = e.suites.find((s) => s.id === node.suiteId)!;
    return trySuite(e, suite);
  }
  if (node.type === "run-case") {
    const suite = e.suites.find((s) => s.id === node.suiteId)!;
    const tc = suite.cases.find((c) => c.id === node.caseId)!;
    return tryCase(e, suite, tc);
  }
  const def = e.ctx.findRequest(node.requestId)!;
  const tc = requestCase(def);
  return tryCase(e, requestSuite(def, tc), tc);
}

interface StepOutcome {
  status: FlowStep["status"];
  output?: FlowOutput;
  notes: string[];
  attempts?: Attempt[];
  child?: TestRun;
  check?: FlowStep["check"];
}

async function runNode(e: Engine, node: FlowNode): Promise<StepOutcome> {
  switch (node.type) {
    case "start":
      return { status: "done", output: "next", notes: [] };
    case "wait": {
      await sleep(node.ms, e.ctx.signal);
      if (e.ctx.signal.aborted) return { status: "cancelled", notes: ["Stopped while waiting."] };
      return { status: "done", output: "next", notes: [`Waited ${formatMs(node.ms)}.`] };
    }
    case "set-var": {
      const name = node.name.trim();
      const value = applyTemplate(node.value, { ...e.ctx.envVars, ...e.vars });
      e.vars[name] = value;
      return { status: "done", output: "next", notes: [`Set ${name} to ${JSON.stringify(value)}.`] };
    }
    case "if": {
      const check = evaluateCondition(node.condition, { vars: { ...e.ctx.envVars, ...e.vars }, lastResult: e.lastResult, lastResponse: e.lastResponse });
      return { status: "done", output: check.passed ? "true" : "false", notes: [], check };
    }
    case "run-case":
    case "run-suite":
    case "run-request": {
      const attempts: Attempt[] = [];
      const before = { ...e.vars };
      const notes: string[] = [];
      let last: TryResult | null = null;
      for (let i = 0; i <= node.retry.times; i++) {
        if (i > 0) {
          await sleep(node.retry.delayMs, e.ctx.signal);
          if (e.ctx.signal.aborted) break;
          // Each try starts from the variables the step started with.
          replaceVars(e.vars, before);
        }
        const start = Date.now();
        const startedAt = new Date(start).toISOString();
        last = await tryRunNode(e, node);
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
      e.lastResult = last.passed ? "passed" : "failed";
      e.lastResponse = last.lastResponse;
      return { status: last.passed ? "passed" : "failed", output: last.passed ? "passed" : "failed", notes, attempts, child: last.child };
    }
  }
}

/**
 * Runs a flow from its Start node (or ctx.entryNodeId), one step at a time, following
 * the wire for each step's output. The run ends when an output has no wire. A failed step
 * with no wire on its failed output stops the flow and marks it failed.
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
  const e: Engine = { flow: snapshot, ctx, suites: structuredClone(ctx.suites), vars: {}, lastResult: null, lastResponse: null };
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const maxSteps = ctx.maxSteps ?? MAX_FLOW_STEPS;
  const startedAt = new Date().toISOString();
  const log: FlowRun["log"] = [
    { at: startedAt, message: `Started flow "${snapshot.name}".` },
    { at: startedAt, message: ctx.environmentName ? `Environment: ${ctx.environmentName}.` : "No environment selected." },
  ];
  const steps: FlowStep[] = [];
  let end: FlowRunEnd = "passed";
  let endReason: string | undefined;

  let current: FlowNode | undefined = ctx.entryNodeId ? byId.get(ctx.entryNodeId) : snapshot.nodes.find((n) => n.type === "start");
  while (current) {
    if (ctx.signal.aborted) {
      end = "cancelled";
      break;
    }
    if (steps.length >= maxSteps) {
      end = "failed";
      endReason = `Stopped after ${maxSteps} steps. Check for a loop that never ends.`;
      break;
    }
    const node: FlowNode = current;
    const label = nodeLabel(node, e.suites, ctx.findRequest);
    ctx.onStepStart?.(node.id, steps.length);
    const stepStart = Date.now();
    const varsBefore = { ...e.vars };
    const outcome = await runNode(e, node);
    const wire = outcome.output ? snapshot.edges.find((w) => w.source === node.id && w.sourceHandle === outcome.output) : undefined;
    const step: FlowStep = {
      index: steps.length,
      nodeId: node.id,
      nodeType: node.type,
      label,
      status: outcome.status,
      output: outcome.output,
      nextNodeId: outcome.output ? (wire?.target ?? null) : undefined,
      startedAt: new Date(stepStart).toISOString(),
      durationMs: Date.now() - stepStart,
      varsBefore,
      varsAfter: { ...e.vars },
      notes: outcome.notes,
      attempts: outcome.attempts,
      child: outcome.child,
      check: outcome.check,
    };
    if (node.type === "if" && outcome.check) step.notes = [`${outcome.check.name}: ${outcome.output}${outcome.check.message ? ` (${outcome.check.message})` : ""}.`];
    steps.push(step);
    ctx.onStep?.(step);

    if (outcome.status === "cancelled") {
      end = "cancelled";
      break;
    }
    if (outcome.status === "failed" && !wire) {
      end = "failed";
      endReason = `"${label}" failed and nothing is wired to its failed output.`;
      break;
    }
    if (outcome.status === "failed") log.push({ at: step.startedAt, message: `"${label}" failed; following its failed wire.` });
    current = wire ? byId.get(wire.target) : undefined;
  }

  const finishedAt = new Date().toISOString();
  if (end === "cancelled") endReason = "Stopped by you.";
  const runSteps = steps.filter((s) => s.attempts);
  const passedSteps = runSteps.filter((s) => s.status === "passed").length;
  const failedSteps = runSteps.filter((s) => s.status === "failed").length;
  log.push({ at: finishedAt, message: endReason ?? "Reached the end of the flow." });
  log.push({
    at: finishedAt,
    message: `Finished ${end}: ${steps.length} step${steps.length === 1 ? "" : "s"}, ${passedSteps} run step${passedSteps === 1 ? "" : "s"} passed, ${failedSteps} failed.`,
  });

  return {
    id: newId(),
    kind: "flow",
    flowId: snapshot.id,
    flowName: snapshot.name,
    environmentName: ctx.environmentName,
    trigger: ctx.trigger ?? "manual",
    startedAt,
    finishedAt,
    end,
    endReason,
    steps: steps.length,
    passedSteps,
    failedSteps,
    flow: snapshot,
    stepList: steps,
    vars: { ...e.vars },
    log,
  };
}
