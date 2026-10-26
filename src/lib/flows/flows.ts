import { newId } from "../ids";
import { load, save } from "../storage";
import { DEFAULT_SCHEDULE, describeSchedule, type Schedule } from "./schedule";
import { ASSERTION_OPS, type TestSuite } from "../testing/types";
import type { RequestDef } from "../types";
import {
  FLOW_NODE_TYPES,
  NO_RETRY,
  NODE_OUTPUTS,
  type ConditionSource,
  type Flow,
  type FlowCondition,
  type FlowEdge,
  type FlowNode,
  type FlowNodeType,
  type FlowPosition,
  type LoopData,
  MULTI_WIRE_OUTPUTS,
  type FlowOutput,
  type RetrySettings,
} from "./types";

export const FLOWS_KEY = "rest-runner.flows";

/** Saved requests and examples a Run request node can point at, by id. */
export type RequestLookup = (id: string) => RequestDef | null;

export const DEFAULT_CONDITION: FlowCondition = { source: "last-result", property: "", op: "eq", expected: "passed" };

const CONDITION_SOURCES: ConditionSource[] = ["status", "time", "size", "header", "body", "json", "variable", "last-result"];

export function newFlow(name = "New flow"): Flow {
  const start: FlowNode = { id: newId(), type: "start", position: { x: 80, y: 160 } };
  return { id: newId(), name, description: "", nodes: [start], edges: [] };
}

/** A node of the given type with empty settings. */
export function newNode(type: FlowNodeType, position: FlowPosition = { x: 0, y: 0 }): FlowNode {
  const base = { id: newId(), position };
  switch (type) {
    case "start":
      return { ...base, type };
    case "schedule":
      return { ...base, type, schedule: { ...DEFAULT_SCHEDULE }, enabled: true };
    case "run-case":
      return { ...base, type, suiteId: "", caseId: "", retry: { ...NO_RETRY } };
    case "run-suite":
      return { ...base, type, suiteId: "", retry: { ...NO_RETRY } };
    case "run-request":
      return { ...base, type, requestId: "", retry: { ...NO_RETRY }, httpErrorsFail: true };
    case "if":
      return { ...base, type, condition: { ...DEFAULT_CONDITION } };
    case "parallel":
    case "join":
      return { ...base, type };
    case "loop":
      return { ...base, type, data: null };
    case "wait":
      return { ...base, type, ms: 1000 };
    case "set-var":
      return { ...base, type, name: "", value: "" };
    case "note":
      return { ...base, type, text: "", width: NOTE_SIZE.width, height: NOTE_SIZE.height };
  }
}

export const NOTE_SIZE = { width: 220, height: 120 };

export function newEdge(source: string, sourceHandle: FlowEdge["sourceHandle"], target: string): FlowEdge {
  return { id: newId(), source, sourceHandle, target };
}

export const NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  start: "Start",
  schedule: "Schedule",
  "run-case": "Run case",
  "run-suite": "Run suite",
  "run-request": "Run request",
  if: "If",
  parallel: "Parallel",
  join: "Join",
  loop: "Loop over CSV",
  wait: "Wait",
  "set-var": "Set variable",
  note: "Sticky note",
};

/** The name shown for a node: its own label, or one made from what it runs. */
export function nodeLabel(node: FlowNode, suites: TestSuite[], findRequest: RequestLookup): string {
  if (node.label && node.label.trim() !== "") return node.label.trim();
  switch (node.type) {
    case "run-case": {
      const suite = suites.find((s) => s.id === node.suiteId);
      const tc = suite?.cases.find((c) => c.id === node.caseId);
      return tc ? `${suite!.name} › ${tc.name}` : "Run case";
    }
    case "run-suite":
      return suites.find((s) => s.id === node.suiteId)?.name ?? "Run suite";
    case "run-request":
      return findRequest(node.requestId)?.name ?? "Run request";
    case "loop":
      return node.data ? `Loop over ${node.data.name}` : "Loop over CSV";
    case "schedule":
      return describeSchedule(node.schedule);
    case "wait":
      return `Wait ${formatMs(node.ms)}`;
    case "set-var":
      return node.name ? `Set ${node.name}` : "Set variable";
    case "note":
      return node.text.split("\n")[0].trim().slice(0, 40) || "Sticky note";
    default:
      return NODE_TYPE_LABELS[node.type];
  }
}

export function formatMs(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} s`;
  return `${ms} ms`;
}

function num(v: unknown, fallback: number, min = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function cleanRetry(v: unknown): RetrySettings {
  const r = (v ?? {}) as Partial<RetrySettings>;
  return { times: Math.min(100, num(r.times, 0)), delayMs: num(r.delayMs, NO_RETRY.delayMs) };
}

function cleanSchedule(v: unknown): Schedule {
  const s = (v ?? {}) as Record<string, unknown>;
  if (s.kind === "interval") return { kind: "interval", minutes: Math.max(1, num(s.minutes, 60, 1)) };
  if (s.kind === "weekdays") {
    const days = Array.isArray(s.days) ? [...new Set(s.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    return { kind: "weekdays", time: str(s.time, "09:00"), days };
  }
  if (s.kind === "daily") return { kind: "daily", time: str(s.time, "09:00") };
  return { ...DEFAULT_SCHEDULE };
}

function cleanCondition(v: unknown): FlowCondition {
  const c = (v ?? {}) as Partial<FlowCondition>;
  return {
    source: CONDITION_SOURCES.includes(c.source as ConditionSource) ? (c.source as ConditionSource) : DEFAULT_CONDITION.source,
    property: str(c.property),
    op: ASSERTION_OPS.includes(c.op as never) ? (c.op as FlowCondition["op"]) : DEFAULT_CONDITION.op,
    expected: str(c.expected),
  };
}

function cleanNode(v: unknown): FlowNode | null {
  if (!v || typeof v !== "object") return null;
  const n = v as Record<string, unknown>;
  if (typeof n.id !== "string" || !FLOW_NODE_TYPES.includes(n.type as FlowNodeType)) return null;
  const p = (n.position ?? {}) as Partial<FlowPosition>;
  const base = {
    id: n.id,
    position: { x: Number.isFinite(p.x) ? Number(p.x) : 0, y: Number.isFinite(p.y) ? Number(p.y) : 0 },
    ...(typeof n.label === "string" && n.label !== "" ? { label: n.label } : {}),
  };
  const type = n.type as FlowNodeType;
  switch (type) {
    case "start":
      return { ...base, type };
    case "schedule":
      return { ...base, type, schedule: cleanSchedule(n.schedule), enabled: n.enabled !== false };
    case "run-case":
      return { ...base, type, suiteId: str(n.suiteId), caseId: str(n.caseId), retry: cleanRetry(n.retry) };
    case "run-suite":
      return { ...base, type, suiteId: str(n.suiteId), retry: cleanRetry(n.retry) };
    case "run-request":
      return { ...base, type, requestId: str(n.requestId), retry: cleanRetry(n.retry), httpErrorsFail: n.httpErrorsFail === false ? false : true };
    case "if":
      return { ...base, type, condition: cleanCondition(n.condition) };
    case "parallel":
    case "join":
      return { ...base, type };
    case "loop": {
      const d = n.data as Partial<LoopData> | null | undefined;
      return { ...base, type, data: d && typeof d.name === "string" && typeof d.text === "string" ? { name: d.name, text: d.text } : null };
    }
    case "wait":
      return { ...base, type, ms: num(n.ms, 1000) };
    case "set-var":
      return { ...base, type, name: str(n.name), value: str(n.value) };
    case "note":
      return { ...base, type, text: str(n.text), width: num(n.width, NOTE_SIZE.width, 80), height: num(n.height, NOTE_SIZE.height, 40) };
  }
}

/** Fills in anything missing from flows loaded from storage or an import, and drops what cannot be used. */
export function cleanFlows(input: unknown): Flow[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && typeof (f as Flow).id === "string")
    .map((f) => {
      const nodes = (Array.isArray(f.nodes) ? f.nodes : []).map(cleanNode).filter((n): n is FlowNode => n !== null);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const edges = (Array.isArray(f.edges) ? f.edges : []).filter((e): e is FlowEdge => {
        if (!e || typeof e !== "object" || typeof e.id !== "string") return false;
        const source = byId.get(e.source);
        return !!source && byId.has(e.target) && NODE_OUTPUTS[source.type].includes(e.sourceHandle);
      });
      return {
        id: f.id as string,
        name: str(f.name, "Flow"),
        description: str(f.description),
        nodes,
        edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target })),
      };
    });
}

export function loadFlows(): Flow[] {
  return cleanFlows(load(FLOWS_KEY, []));
}

/** Returns false when storage refused the value. */
export function saveFlows(flows: Flow[]): boolean {
  return save(FLOWS_KEY, flows);
}

/** The palette and the step picker group step types like this, in this order. */
export const STEP_GROUPS: { label: string; types: FlowNodeType[] }[] = [
  { label: "Triggers", types: ["start", "schedule"] },
  { label: "Run", types: ["run-case", "run-suite", "run-request"] },
  { label: "Logic", types: ["if", "parallel", "join", "loop"] },
  { label: "Utility", types: ["wait", "set-var", "note"] },
];

/** Step types with an input, so a wire can lead to them. */
export function canFollow(type: FlowNodeType): boolean {
  return type !== "start" && type !== "schedule" && type !== "note";
}

/** Groups that have a step matching the typed text (by name or group), with only the matching steps. Empty text keeps everything. */
export function filterStepGroups(query: string, groups = STEP_GROUPS): { label: string; types: FlowNodeType[] }[] {
  const q = query.trim().toLowerCase();
  if (q === "") return groups;
  return groups
    .map((g) => ({ label: g.label, types: g.types.filter((t) => NODE_TYPE_LABELS[t].toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) }))
    .filter((g) => g.types.length > 0);
}

/** Whether a step output can take another wire: it has none yet, or it is one that takes many. */
export function outputIsFree(flow: Flow, nodeId: string, output: FlowOutput): boolean {
  return MULTI_WIRE_OUTPUTS.includes(output) || !flow.edges.some((e) => e.source === nodeId && e.sourceHandle === output);
}

/** The first output of a node that can take a wire, or null. */
export function firstFreeOutput(flow: Flow, nodeId: string): FlowOutput | null {
  const node = flow.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return NODE_OUTPUTS[node.type].find((o) => outputIsFree(flow, nodeId, o)) ?? null;
}

export const STEP_OFFSET_X = 260;
const STEP_STACK_Y = 90;

/** A spot to the right of a position, moved down until it does not sit on another step. */
export function freeSpotRightOf(flow: Flow, from: FlowPosition): FlowPosition {
  const x = Math.round(from.x + STEP_OFFSET_X);
  let y = Math.round(from.y);
  while (flow.nodes.some((n) => n.type !== "note" && Math.abs(n.position.x - x) < 200 && Math.abs(n.position.y - y) < 80)) y += STEP_STACK_Y;
  return { x, y };
}

/**
 * Adds a step 260 px to the right of a step (lower down if that spot is taken) and, when the new
 * step has an input and an output is given, wires it from that output. An output that already has a
 * wire (and takes only one) is rewired to the new step. Returns the flow unchanged when the step is missing.
 */
export function addStepAfter(flow: Flow, nodeId: string, output: FlowOutput | null, type: FlowNodeType): { flow: Flow; node: FlowNode | null } {
  const from = flow.nodes.find((n) => n.id === nodeId);
  if (!from) return { flow, node: null };
  const node = newNode(type, freeSpotRightOf(flow, from.position));
  let edges = flow.edges;
  if (output && canFollow(type) && NODE_OUTPUTS[from.type].includes(output)) {
    const multi = MULTI_WIRE_OUTPUTS.includes(output);
    edges = [...edges.filter((e) => multi || !(e.source === nodeId && e.sourceHandle === output)), newEdge(nodeId, output, node.id)];
  }
  return { flow: { ...flow, nodes: [...flow.nodes, node], edges }, node };
}

/**
 * Adding from the palette by click: next to the selected step wired from its first free output, or
 * (with nothing selected) next to the last step that is not a note.
 */
export function addStepFromPalette(flow: Flow, selectedId: string | null, type: FlowNodeType): { flow: Flow; node: FlowNode | null } {
  const anchor = (selectedId && flow.nodes.find((n) => n.id === selectedId)) || [...flow.nodes].reverse().find((n) => n.type !== "note") || null;
  if (!anchor) {
    const node = newNode(type, { x: 80, y: 160 });
    return { flow: { ...flow, nodes: [...flow.nodes, node] }, node };
  }
  return addStepAfter(flow, anchor.id, firstFreeOutput(flow, anchor.id), type);
}
