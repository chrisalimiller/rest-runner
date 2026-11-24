import type { RequestLookup } from "../flows/flows";
import { newId } from "../ids";
import { requestPlaceholders } from "../request";
import { isArray, load, save } from "../storage";
import type { HttpMethod } from "../types";
import { orderCalls } from "./order";
import {
  BLOCK_TYPES,
  FIELD_FORMATS,
  MAX_BLOCKS_PER_ROW,
  type BlockField,
  type BlockType,
  type ItemRule,
  type ListItemChoice,
  type ListRef,
  type PickRowSetting,
  type PlaceholderMapping,
  type Tool,
  type ToolBlock,
  type ToolCall,
  type ToolInput,
  type ToolList,
  type ToolProblem,
  type Where,
} from "./types";

export const TOOLS_KEY = "rest-runner.tools";

const WRITE_METHODS: HttpMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

/** Whether a call to a request with this method starts out as a write call. */
export function defaultIsWrite(method: HttpMethod): boolean {
  return WRITE_METHODS.includes(method);
}

export function newTool(name = "New tool"): Tool {
  return {
    id: newId(),
    name,
    description: "",
    inputs: [],
    calls: [],
    blocks: [],
    settings: { environmentId: null, runOnOpen: false, keepHistory: true },
  };
}

export function newInput(name: string, kind: ToolInput["kind"] = "text"): ToolInput {
  return { name, label: name, kind, ...(kind === "dropdown" ? { options: [] } : {}) };
}

export function newCall(requestId: string, name: string, method?: HttpMethod): ToolCall {
  return { id: newId(), name, requestId, mappings: {}, write: method ? defaultIsWrite(method) : false };
}

export function newBlock(type: BlockType, row: number, extra: Partial<ToolBlock> = {}): ToolBlock {
  return { id: newId(), type, title: "", fields: [], row, ...extra };
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cleanInput(v: unknown): ToolInput | null {
  if (!isObject(v) || typeof v.name !== "string") return null;
  const kind = v.kind === "dropdown" ? "dropdown" : "text";
  const out: ToolInput = { name: v.name, label: str(v.label, v.name), kind };
  if (typeof v.default === "string") out.default = v.default;
  if (kind === "dropdown") out.options = Array.isArray(v.options) ? v.options.filter((o): o is string => typeof o === "string") : [];
  return out;
}

function cleanMapping(v: unknown): PlaceholderMapping | null {
  if (!isObject(v)) return null;
  const m: PlaceholderMapping = {};
  if (typeof v.input === "string" && v.input !== "") m.input = v.input;
  if (isObject(v.call) && typeof v.call.callId === "string" && v.call.callId !== "") {
    const list = cleanListRef(v.call.list);
    m.call = { callId: v.call.callId, path: str(v.call.path), ...(list ? { list } : {}) };
  }
  if (typeof v.fixed === "string") m.fixed = v.fixed;
  return Object.keys(m).length > 0 ? m : null;
}

// ---- lists ----

function cleanWhere(v: unknown): Where | null {
  if (!isObject(v) || typeof v.field !== "string") return null;
  return { field: v.field, op: v.op === "ne" ? "ne" : "eq", value: cleanMapping(v.value) ?? {} };
}

/** A rule for choosing an item. Null for anything that is not one. */
function cleanRule(v: unknown): ItemRule | null {
  if (!isObject(v)) return null;
  switch (v.kind) {
    case "none":
      return { kind: "none" };
    case "ask":
      return { kind: "ask" };
    case "index":
      return typeof v.index === "number" && Number.isInteger(v.index) ? { kind: "index", index: v.index } : null;
    case "where": {
      const w = cleanWhere(v);
      return w ? { kind: "where", ...w } : null;
    }
    default:
      return null;
  }
}

function cleanItemChoice(v: unknown): ListItemChoice | null {
  if (!isObject(v)) return null;
  if (v.kind === "all") {
    const where = cleanWhere(v.where);
    return { kind: "all", join: typeof v.join === "string" ? v.join : ", ", ...(where ? { where } : {}) };
  }
  if (v.kind === "count") {
    const where = cleanWhere(v.where);
    return { kind: "count", ...(where ? { where } : {}) };
  }
  return cleanRule(v);
}

function cleanListRef(v: unknown): ListRef | null {
  if (!isObject(v) || typeof v.listId !== "string" || v.listId === "") return null;
  const item = cleanItemChoice(v.item);
  return { listId: v.listId, ...(item ? { item } : {}) };
}

/**
 * The lists of a call. A list needs an id and a name; one that sits inside a list that is not there (or inside
 * itself) is dropped, since reading it from the whole response would give other values than were meant.
 */
function cleanLists(v: unknown): ToolList[] {
  const first: ToolList[] = [];
  const ids = new Set<string>();
  for (const l of Array.isArray(v) ? v : []) {
    if (!isObject(l) || typeof l.id !== "string" || l.id === "" || ids.has(l.id)) continue;
    ids.add(l.id);
    first.push({
      id: l.id,
      name: str(l.name, "List"),
      path: str(l.path),
      ...(typeof l.parentListId === "string" && l.parentListId !== "" ? { parentListId: l.parentListId } : {}),
      labelPath: str(l.labelPath),
      choose: cleanRule(l.choose) ?? { kind: "none" },
      ...(typeof l.autoPickSingle === "boolean" ? { autoPickSingle: l.autoPickSingle } : {}),
    });
  }
  const byId = new Map(first.map((l) => [l.id, l]));
  const sound = (l: ToolList): boolean => {
    const seen = new Set<string>([l.id]);
    for (let p = l.parentListId; p !== undefined; ) {
      const parent = byId.get(p);
      if (!parent || seen.has(p)) return false;
      seen.add(p);
      p = parent.parentListId;
    }
    return true;
  };
  return first.filter(sound);
}

function cleanPickRow(v: unknown): PickRowSetting | undefined {
  if (!isObject(v)) return undefined;
  return { listPath: str(v.listPath), labelPath: str(v.labelPath) };
}

function cleanCall(v: unknown): ToolCall | null {
  if (!isObject(v) || typeof v.id !== "string") return null;
  const mappings: Record<string, PlaceholderMapping> = {};
  if (isObject(v.mappings)) {
    for (const [k, m] of Object.entries(v.mappings)) {
      const c = cleanMapping(m);
      if (c) mappings[k] = c;
    }
  }
  const pickRow = cleanPickRow(v.pickRow);
  // A call has either pickRow or lists, never both: pickRow keeps its meaning.
  const lists = pickRow ? [] : cleanLists(v.lists);
  return { id: v.id, name: str(v.name, "Call"), requestId: str(v.requestId), mappings, write: v.write === true, ...(pickRow ? { pickRow } : {}), ...(lists.length > 0 ? { lists } : {}) };
}

function cleanField(v: unknown): BlockField | null {
  if (!isObject(v)) return null;
  const format = FIELD_FORMATS.includes(v.format as never) ? (v.format as BlockField["format"]) : "text";
  const list = cleanListRef(v.list);
  return { path: str(v.path), label: str(v.label), format, ...(list ? { list } : {}) };
}

function cleanBlock(v: unknown, index: number): ToolBlock | null {
  if (!isObject(v) || typeof v.id !== "string" || !BLOCK_TYPES.includes(v.type as never)) return null;
  const row = typeof v.row === "number" && Number.isFinite(v.row) ? Math.max(0, Math.floor(v.row)) : index;
  const fields = (Array.isArray(v.fields) ? v.fields : []).map(cleanField).filter((f): f is BlockField => f !== null);
  return {
    id: v.id,
    type: v.type as BlockType,
    title: str(v.title),
    ...(typeof v.callId === "string" && v.callId !== "" ? { callId: v.callId } : {}),
    ...(typeof v.inputName === "string" && v.inputName !== "" ? { inputName: v.inputName } : {}),
    fields,
    ...(typeof v.text === "string" ? { text: v.text } : {}),
    ...(typeof v.listId === "string" && v.listId !== "" ? { listId: v.listId } : {}),
    row,
  };
}

/** Fills in anything missing from tools loaded from storage or an import, and drops what cannot be used. */
export function cleanTools(input: unknown): Tool[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const t of input) {
    if (!isObject(t) || typeof t.id !== "string" || seen.has(t.id)) continue;
    seen.add(t.id);
    const s = isObject(t.settings) ? t.settings : {};
    const callIds = new Set<string>();
    const calls = (Array.isArray(t.calls) ? t.calls : []).map(cleanCall).filter((c): c is ToolCall => {
      if (!c || callIds.has(c.id)) return false;
      callIds.add(c.id);
      return true;
    });
    out.push({
      id: t.id,
      name: str(t.name, "Tool"),
      description: str(t.description),
      inputs: (Array.isArray(t.inputs) ? t.inputs : []).map(cleanInput).filter((i): i is ToolInput => i !== null),
      calls,
      blocks: (Array.isArray(t.blocks) ? t.blocks : []).map(cleanBlock).filter((b): b is ToolBlock => b !== null),
      settings: {
        environmentId: typeof s.environmentId === "string" ? s.environmentId : null,
        runOnOpen: s.runOnOpen === true,
        keepHistory: s.keepHistory !== false,
      },
    });
  }
  return out;
}

export function loadTools(): Tool[] {
  return cleanTools(load<unknown>(TOOLS_KEY, [], isArray));
}

/** Returns false when storage refused the value. */
export function saveTools(tools: Tool[]): boolean {
  return save(TOOLS_KEY, tools);
}

/** The placeholders of the call's request that the call maps, in the form orderCalls wants. Null when the request is missing. */
export function placeholdersForCall(call: ToolCall, findRequest: RequestLookup): string[] | null {
  const def = findRequest(call.requestId);
  return def ? requestPlaceholders(def) : null;
}

/** Everything wrong with a tool. Errors stop Look up; warnings only describe what will be skipped or ignored. */
export function validateTool(tool: Tool, findRequest: RequestLookup): ToolProblem[] {
  const problems: ToolProblem[] = [];
  const order = orderCalls(tool.calls, (c) => placeholdersForCall(c, findRequest));
  if (!order.ok) problems.push({ level: "error", code: "cycle", message: order.message, callId: order.cycle[0] });

  const inputNames = new Set<string>();
  for (const i of tool.inputs) {
    if (inputNames.has(i.name)) problems.push({ level: "error", code: "duplicate-input", message: `Two inputs are named ${i.name}.` });
    inputNames.add(i.name);
  }
  const callIds = new Set(tool.calls.map((c) => c.id));
  for (const c of tool.calls) {
    if (!findRequest(c.requestId)) problems.push({ level: "warning", code: "missing-request", message: `${c.name}: Request missing.`, callId: c.id });
    for (const [placeholder, m] of Object.entries(c.mappings)) {
      if (m.input !== undefined && !inputNames.has(m.input)) problems.push({ level: "warning", code: "unknown-input", message: `${c.name}: {{${placeholder}}} uses input ${m.input}, which does not exist.`, callId: c.id });
      if (m.call && !callIds.has(m.call.callId)) problems.push({ level: "warning", code: "unknown-call", message: `${c.name}: {{${placeholder}}} uses a call that was removed.`, callId: c.id });
    }
  }
  const perRow = new Map<number, number>();
  for (const b of tool.blocks) {
    perRow.set(b.row, (perRow.get(b.row) ?? 0) + 1);
    if (b.callId !== undefined && !callIds.has(b.callId)) problems.push({ level: "warning", code: "unknown-block-call", message: `${b.title || "A block"} uses a call that was removed.`, blockId: b.id });
  }
  for (const [row, n] of perRow) {
    if (n > MAX_BLOCKS_PER_ROW) problems.push({ level: "warning", code: "too-many-in-row", message: `Row ${row + 1} has ${n} blocks; at most ${MAX_BLOCKS_PER_ROW} fit.` });
  }
  return problems;
}

export function hasToolErrors(problems: ToolProblem[]): boolean {
  return problems.some((p) => p.level === "error");
}
