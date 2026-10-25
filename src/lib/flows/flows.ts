import { newId } from "../ids";
import { load, save } from "../storage";
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
    case "run-case":
      return { ...base, type, suiteId: "", caseId: "", retry: { ...NO_RETRY } };
    case "run-suite":
      return { ...base, type, suiteId: "", retry: { ...NO_RETRY } };
    case "run-request":
      return { ...base, type, requestId: "", retry: { ...NO_RETRY } };
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
    case "run-case":
      return { ...base, type, suiteId: str(n.suiteId), caseId: str(n.caseId), retry: cleanRetry(n.retry) };
    case "run-suite":
      return { ...base, type, suiteId: str(n.suiteId), retry: cleanRetry(n.retry) };
    case "run-request":
      return { ...base, type, requestId: str(n.requestId), retry: cleanRetry(n.retry) };
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
