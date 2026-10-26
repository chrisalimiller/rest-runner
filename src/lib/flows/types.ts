import type { Vars } from "../template";
import type { Schedule } from "./schedule";
import type { TestRun } from "../testing/testRun";
import type { AssertionOp, AssertionSource, Check } from "../testing/types";

/** The name of a node's output, which is also the handle a wire leaves from. */
export type FlowOutput = "next" | "passed" | "failed" | "true" | "false" | "branches" | "row" | "done";

/** Outputs that can have any number of wires (each wire is a branch). Every other output has at most one. */
export const MULTI_WIRE_OUTPUTS: FlowOutput[] = ["branches"];

export interface FlowPosition {
  x: number;
  y: number;
}

/** Try a Run step again when it fails: up to `times` more tries, waiting `delayMs` before each. */
export interface RetrySettings {
  times: number;
  delayMs: number;
}

export const NO_RETRY: RetrySettings = { times: 0, delayMs: 1000 };

/**
 * What an If node checks.
 * Response sources (status, time, size, header, body, json) read the response of the last Run step.
 * "variable" reads a flow variable (property is its name). "last-result" is "passed" or "failed" for the last Run step.
 */
export type ConditionSource = AssertionSource | "variable" | "last-result";

export interface FlowCondition {
  source: ConditionSource;
  /** Header name, JSON path or variable name. Unused for the other sources. */
  property: string;
  op: AssertionOp;
  /** May contain {{placeholders}}. */
  expected: string;
}

interface NodeBase {
  id: string;
  position: FlowPosition;
  /** A name shown on the canvas and in reports. Empty means a name made from what the node runs. */
  label?: string;
}

export interface StartNode extends NodeBase {
  type: "start";
}

/** Starts the flow at set times while the app is open. */
export interface ScheduleNode extends NodeBase {
  type: "schedule";
  schedule: Schedule;
  /** Off: the schedule is kept but never starts a run. */
  enabled: boolean;
}

export interface RunCaseNode extends NodeBase {
  type: "run-case";
  suiteId: string;
  caseId: string;
  retry: RetrySettings;
}

export interface RunSuiteNode extends NodeBase {
  type: "run-suite";
  suiteId: string;
  retry: RetrySettings;
}

export interface RunRequestNode extends NodeBase {
  type: "run-request";
  /** A saved request or saved example, by id. */
  requestId: string;
  retry: RetrySettings;
  /** A 4xx/5xx response fails the step. Missing (flows saved before this) means true. */
  httpErrorsFail?: boolean;
}

export interface IfNode extends NodeBase {
  type: "if";
  condition: FlowCondition;
}

export interface WaitNode extends NodeBase {
  type: "wait";
  ms: number;
}

export interface SetVarNode extends NodeBase {
  type: "set-var";
  name: string;
  /** May contain {{placeholders}}. */
  value: string;
}

/** Starts every branch wired to it at the same time. */
export interface ParallelNode extends NodeBase {
  type: "parallel";
}

/** Waits for every branch of a Parallel, merges their variables, then continues. */
export interface JoinNode extends NodeBase {
  type: "join";
}

/** CSV text saved on a Loop node. */
export interface LoopData {
  name: string;
  text: string;
}

/** Runs the steps wired to "row" once per CSV row, then continues from "done". */
export interface LoopNode extends NodeBase {
  type: "loop";
  data: LoopData | null;
}

/** Free text on the canvas to explain a flow. Never run, and has no wires. */
export interface NoteNode extends NodeBase {
  type: "note";
  text: string;
  width: number;
  height: number;
}

export type RunNode = RunCaseNode | RunSuiteNode | RunRequestNode;
export type FlowNode =
  | StartNode
  | ScheduleNode
  | RunCaseNode
  | RunSuiteNode
  | RunRequestNode
  | IfNode
  | ParallelNode
  | JoinNode
  | LoopNode
  | WaitNode
  | SetVarNode
  | NoteNode;
export type FlowNodeType = FlowNode["type"];

export const FLOW_NODE_TYPES: FlowNodeType[] = ["start", "schedule", "run-case", "run-suite", "run-request", "if", "parallel", "join", "loop", "wait", "set-var", "note"];

/** The outputs each node type has, in the order they are drawn. */
export const NODE_OUTPUTS: Record<FlowNodeType, FlowOutput[]> = {
  start: ["next"],
  schedule: ["next"],
  "run-case": ["passed", "failed"],
  "run-suite": ["passed", "failed"],
  "run-request": ["passed", "failed"],
  if: ["true", "false"],
  parallel: ["branches"],
  join: ["passed", "failed"],
  loop: ["row", "done"],
  wait: ["next"],
  "set-var": ["next"],
  note: [],
};

/** A wire from one node's output to another node. */
export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: FlowOutput;
  target: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** One try of a Run step. */
export interface Attempt {
  passed: boolean;
  startedAt: string;
  durationMs: number;
  /** The first failed check, or why the step could not run. */
  reason?: string;
}

/**
 * passed / failed: Run steps, Join, and Loop over CSV.
 * done: steps that cannot fail (Start, Schedule, Wait, Set variable, If, Parallel).
 * cancelled: Stop was pressed while the step ran.
 */
export type FlowStepStatus = "passed" | "failed" | "done" | "cancelled";

export interface FlowStep {
  /** 0-based position in the run, in the order steps started. */
  index: number;
  /** Which parallel branch ran the step: "" outside Parallel, "2" for the second branch, "2.1" for a branch inside it. */
  branch?: string;
  /** The 0-based CSV row of the innermost Loop over CSV the step ran in. */
  row?: number;
  nodeId: string;
  nodeType: FlowNodeType;
  label: string;
  status: FlowStepStatus;
  /** The output the flow left by. Missing when the step was cancelled. */
  output?: FlowOutput;
  /** The node the flow went to next; null when the output had no wire. */
  nextNodeId?: string | null;
  startedAt: string;
  durationMs: number;
  varsBefore: Vars;
  varsAfter: Vars;
  notes: string[];
  /** Run steps: every try, in order. */
  attempts?: Attempt[];
  /** Run steps: the full suite or case report of the last try. */
  child?: TestRun;
  /** If steps: the condition as checked. */
  check?: Check;
}

/**
 * passed: the flow reached a step with nothing wired after it, and no Run step failed on the way.
 * passed-handled: it got there, but only because a failed Run step had a wire for its failed output.
 * failed: a step failed with nothing wired to its failed output, or the flow could not go on.
 * cancelled: Stop was pressed.
 */
export type FlowRunEnd = "passed" | "passed-handled" | "failed" | "cancelled";

export interface FlowRunSummary {
  id: string;
  kind: "flow";
  flowId: string;
  flowName: string;
  environmentName?: string;
  /** "manual" for the Run button, or the id of the Schedule step that started the run. */
  trigger: string;
  /** For scheduled runs: the schedule as text, such as "Daily at 09:00". */
  triggerLabel?: string;
  startedAt: string;
  finishedAt: string;
  end: FlowRunEnd;
  /** Why the flow failed or stopped, when it did. */
  endReason?: string;
  steps: number;
  /** Run steps that passed and failed (a failure followed by its failed wire still counts). */
  passedSteps: number;
  failedSteps: number;
}

export interface FlowRun extends FlowRunSummary {
  /** The flow as it was when the run started. */
  flow: Flow;
  stepList: FlowStep[];
  /** Flow variables when the run ended. */
  vars: Vars;
  log: { at: string; message: string }[];
}
