import type { RequestLookup } from "../flows/flows";
import { requestPlaceholders } from "../request";
import { parsePath } from "../testing/jsonPath";
import type { HttpMethod } from "../types";
import { callJson, pickRows } from "./engine";
import { callDependencies, orderCalls } from "./order";
import { newBlock, newCall, validateTool } from "./tools";
import {
  MAX_BLOCKS_PER_ROW,
  type BlockField,
  type BlockType,
  type CallResult,
  type FieldFormat,
  type PickRowSetting,
  type PlaceholderMapping,
  type Tool,
  type ToolBlock,
  type ToolCall,
  type ToolInput,
  type ToolProblem,
} from "./types";
import { BADGE_COLOURS, tableRows, type BadgeColour } from "./view";

/**
 * The logic of Build mode as plain functions: every edit takes a tool (or its blocks) and returns a new one,
 * so it can be tested without a screen. The screens in components/tools only call these.
 */

// ---- the block page: rows of blocks ----

export interface BlockInfo {
  type: BlockType;
  label: string;
  hint: string;
}

export const BLOCK_INFO: readonly BlockInfo[] = [
  { type: "input", label: "Input", hint: "A box to type an ID or pick a value" },
  { type: "fields", label: "Fields", hint: "Label and value pairs from one request" },
  { type: "table", label: "Table", hint: "A row for each item of a list" },
  { type: "number", label: "Number", hint: "One big number, such as a balance" },
  { type: "status", label: "Status", hint: "A coloured badge for a status value" },
  { type: "json", label: "JSON", hint: "The response, or part of it, as it came" },
  { type: "note", label: "Note", hint: "Text you write, such as a tip" },
  { type: "action", label: "Action", hint: "A button that runs a write request" },
];

export function blockLabel(type: BlockType): string {
  return BLOCK_INFO.find((b) => b.type === type)?.label ?? type;
}

/** The block list as filtered by what is typed after the slash. Empty text shows everything. */
export function filterBlockTypes(query: string): BlockInfo[] {
  const q = query.trim().replace(/^\//, "").toLowerCase();
  if (!q) return [...BLOCK_INFO];
  return BLOCK_INFO.filter((b) => b.type.startsWith(q) || b.label.toLowerCase().startsWith(q) || b.hint.toLowerCase().split(/\W+/).some((w) => w.startsWith(q)));
}

/** Blocks grouped by row, rows in order, blocks in array order. */
export function groupRows(blocks: readonly ToolBlock[]): ToolBlock[][] {
  const rows = new Map<number, ToolBlock[]>();
  for (const b of blocks) rows.set(b.row, [...(rows.get(b.row) ?? []), b]);
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

function flatten(rows: ToolBlock[][]): ToolBlock[] {
  const out: ToolBlock[] = [];
  let row = 0;
  for (const r of rows) {
    if (r.length === 0) continue;
    for (let i = 0; i < r.length; i += MAX_BLOCKS_PER_ROW) {
      for (const b of r.slice(i, i + MAX_BLOCKS_PER_ROW)) out.push(b.row === row ? b : { ...b, row });
      row++;
    }
  }
  return out;
}

/** Rows counted 0, 1, 2 with no gaps, in order, and none with more than MAX_BLOCKS_PER_ROW blocks (extra blocks start a new row). */
export function normalizeBlocks(blocks: readonly ToolBlock[]): ToolBlock[] {
  return flatten(groupRows(blocks));
}

export type DropTarget =
  /** A row of its own, placed before row `index` (the number of rows puts it last). Rows are counted before the move. */
  | { kind: "new-row"; index: number }
  /** Into `row`, before the block at `position` (the row's length puts it last). Counted before the move. */
  | { kind: "in-row"; row: number; position: number };

function sameLayout(a: readonly ToolBlock[], b: readonly ToolBlock[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.row === b[i].row);
}

/** Moves a block. Returns the same array when nothing changes (unknown block, a full row, or the block would land where it is). */
export function moveBlock(blocks: readonly ToolBlock[], id: string, target: DropTarget): ToolBlock[] {
  const same = blocks as ToolBlock[];
  const start = normalizeBlocks(blocks);
  const rows = groupRows(start);
  const fromRow = rows.findIndex((r) => r.some((b) => b.id === id));
  if (fromRow < 0) return same;
  const block = rows[fromRow].find((b) => b.id === id)!;
  const fromPos = rows[fromRow].indexOf(block);
  const next: ToolBlock[][] = rows.map((r) => r.filter((b) => b.id !== id));
  if (target.kind === "new-row") {
    const at = Math.max(0, Math.min(rows.length, target.index));
    next.splice(at, 0, [block]);
    // The emptied row is dropped by flatten, which keeps the order of the rest.
  } else {
    const row = Math.max(0, Math.min(rows.length - 1, target.row));
    let position = Math.max(0, Math.min(rows[row].length, target.position));
    if (row === fromRow && fromPos < position) position -= 1;
    if (next[row].length >= MAX_BLOCKS_PER_ROW) return same;
    next[row].splice(position, 0, block);
  }
  const out = flatten(next);
  return sameLayout(out, start) && sameLayout(start, blocks) ? same : out;
}

export type BlockStep = "up" | "down" | "left" | "right";

/** The keyboard way to move a block: left and right inside a row, up and down between rows. */
export function stepBlock(blocks: readonly ToolBlock[], id: string, step: BlockStep): ToolBlock[] {
  const same = blocks as ToolBlock[];
  const rows = groupRows(normalizeBlocks(blocks));
  const r = rows.findIndex((row) => row.some((b) => b.id === id));
  if (r < 0) return same;
  const p = rows[r].findIndex((b) => b.id === id);
  const alone = rows[r].length === 1;
  switch (step) {
    case "left":
      return p === 0 ? same : moveBlock(blocks, id, { kind: "in-row", row: r, position: p - 1 });
    case "right":
      return p === rows[r].length - 1 ? same : moveBlock(blocks, id, { kind: "in-row", row: r, position: p + 2 });
    case "up":
      if (alone) return r === 0 ? same : moveBlock(blocks, id, { kind: "new-row", index: r - 1 });
      return moveBlock(blocks, id, { kind: "new-row", index: r });
    case "down":
      if (alone) return r === rows.length - 1 ? same : moveBlock(blocks, id, { kind: "new-row", index: r + 2 });
      return moveBlock(blocks, id, { kind: "new-row", index: r + 1 });
  }
}

/** Whether a block can go into `row` (it is in that row already, or the row has room). */
export function rowHasRoom(blocks: readonly ToolBlock[], row: number, movingId?: string): boolean {
  const r = groupRows(normalizeBlocks(blocks))[row];
  if (!r) return false;
  return r.filter((b) => b.id !== movingId).length < MAX_BLOCKS_PER_ROW;
}

/** A new block of a type, filled in with what is obvious: an input block shows the first input no block shows yet. */
export function blankBlock(tool: Tool, type: BlockType): ToolBlock {
  if (type === "input") {
    const shown = new Set(tool.blocks.filter((b) => b.type === "input").map((b) => b.inputName));
    const input = tool.inputs.find((i) => !shown.has(i.name)) ?? tool.inputs[0];
    return newBlock(type, 0, input ? { inputName: input.name } : {});
  }
  if (type === "note") return newBlock(type, 0, { text: "" });
  const call = type === "action" ? tool.calls.find((c) => c.write) : tool.calls.length === 1 ? tool.calls[0] : undefined;
  return newBlock(type, 0, call ? { callId: call.id } : {});
}

/** Adds a block as a row of its own, last unless `atRow` says where. */
export function addBlock(blocks: readonly ToolBlock[], block: ToolBlock, atRow?: number): ToolBlock[] {
  const rows = groupRows(normalizeBlocks(blocks));
  const at = atRow === undefined ? rows.length : Math.max(0, Math.min(rows.length, atRow));
  rows.splice(at, 0, [{ ...block, row: at }]);
  return flatten(rows);
}

export function deleteBlock(blocks: readonly ToolBlock[], id: string): ToolBlock[] {
  return normalizeBlocks(blocks.filter((b) => b.id !== id));
}

/** A copy right after the block, in the same row when there is room, else in a row of its own below. */
export function duplicateBlock(blocks: readonly ToolBlock[], id: string, newBlockId: string): ToolBlock[] {
  const rows = groupRows(normalizeBlocks(blocks));
  const r = rows.findIndex((row) => row.some((b) => b.id === id));
  if (r < 0) return blocks as ToolBlock[];
  const src = rows[r].find((b) => b.id === id)!;
  const copy: ToolBlock = { ...src, id: newBlockId, fields: src.fields.map((f) => ({ ...f })) };
  if (rows[r].length < MAX_BLOCKS_PER_ROW) rows[r].splice(rows[r].indexOf(src) + 1, 0, copy);
  else rows.splice(r + 1, 0, [copy]);
  return flatten(rows);
}

export function updateBlock(tool: Tool, id: string, patch: Partial<ToolBlock>): Tool {
  return { ...tool, blocks: tool.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

// ---- calls ----

/** `base`, or `base 2`, `base 3`... whichever is not used yet (ignoring case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const root = base.trim() || "Call";
  if (!used.has(root.toLowerCase())) return root;
  for (let n = 2; ; n++) if (!used.has(`${root} ${n}`.toLowerCase())) return `${root} ${n}`;
}

/** Adds a call to a saved request. The same request may be added again; the copy gets its own name. */
export function addCall(tool: Tool, request: { id: string; name: string; method: HttpMethod }): { tool: Tool; call: ToolCall } {
  const call = newCall(
    request.id,
    uniqueName(request.name || "Request", tool.calls.map((c) => c.name)),
    request.method,
  );
  return { tool: { ...tool, calls: [...tool.calls, call] }, call };
}

function isEmptyMapping(m: PlaceholderMapping): boolean {
  return m.input === undefined && m.call === undefined && m.fixed === undefined;
}

function without<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

/** Removes a call. Other calls stop reading its fields; blocks that showed it are kept, waiting for a request to be chosen. */
export function removeCall(tool: Tool, callId: string): Tool {
  const calls = tool.calls
    .filter((c) => c.id !== callId)
    .map((c) => {
      let changed = false;
      const mappings: Record<string, PlaceholderMapping> = {};
      for (const [k, m] of Object.entries(c.mappings)) {
        if (m.call?.callId === callId) {
          changed = true;
          const rest = without(m, "call");
          if (!isEmptyMapping(rest)) mappings[k] = rest;
        } else mappings[k] = m;
      }
      return changed ? { ...c, mappings } : c;
    });
  const blocks = tool.blocks.map((b) => (b.callId === callId ? { ...without(b, "callId"), fields: [] } : b));
  return { ...tool, calls, blocks };
}

export function updateCall(tool: Tool, callId: string, patch: Partial<ToolCall>): Tool {
  return { ...tool, calls: tool.calls.map((c) => (c.id === callId ? { ...c, ...patch } : c)) };
}

export function renameCall(tool: Tool, callId: string, name: string): Tool {
  return updateCall(tool, callId, { name });
}

export function setCallWrite(tool: Tool, callId: string, write: boolean): Tool {
  return updateCall(tool, callId, { write });
}

/** Sets or clears "ask me to pick a row". */
export function setPickRow(tool: Tool, callId: string, pickRow: PickRowSetting | null): Tool {
  return { ...tool, calls: tool.calls.map((c) => (c.id !== callId ? c : pickRow ? { ...c, pickRow } : without(c, "pickRow"))) };
}

// ---- placeholder mappings ----

export type SourceKind = "input" | "call" | "fixed";
export const SOURCE_KINDS: readonly SourceKind[] = ["input", "call", "fixed"];

/** The sources a mapping has, in the order the engine tries them. */
export function mappingSources(m: PlaceholderMapping | undefined): SourceKind[] {
  const out: SourceKind[] = [];
  if (m?.input !== undefined) out.push("input");
  if (m?.call !== undefined) out.push("call");
  if (m?.fixed !== undefined) out.push("fixed");
  return out;
}

/** Sets one source of a mapping (null removes it). A mapping with no source left is removed, which means the environment. */
export function setMappingSource(call: ToolCall, placeholder: string, kind: SourceKind, value: string | { callId: string; path: string } | null): ToolCall {
  const current: PlaceholderMapping = { ...(call.mappings[placeholder] ?? {}) };
  if (value === null) delete current[kind];
  else (current as Record<string, unknown>)[kind] = value;
  const mappings = { ...call.mappings };
  if (isEmptyMapping(current)) delete mappings[placeholder];
  else mappings[placeholder] = current;
  return { ...call, mappings };
}

/** Drops the mappings of placeholders the request no longer uses. */
export function pruneMappings(call: ToolCall, placeholders: readonly string[]): ToolCall {
  const keep = Object.entries(call.mappings).filter(([k]) => placeholders.includes(k));
  if (keep.length === Object.keys(call.mappings).length) return call;
  return { ...call, mappings: Object.fromEntries(keep) };
}

/** Prunes every call whose request can be found. A call whose request is missing keeps its mappings, in case the request comes back. */
export function pruneToolMappings(tool: Tool, findRequest: RequestLookup): Tool {
  let changed = false;
  const calls = tool.calls.map((c) => {
    const def = findRequest(c.requestId);
    if (!def) return c;
    const next = pruneMappings(c, requestPlaceholders(def));
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...tool, calls } : tool;
}

/** The calls that depend, directly or through others, on `callId`. */
export function dependentCallIds(tool: Tool, callId: string, findRequest?: RequestLookup): Set<string> {
  const placeholders = (c: ToolCall) => {
    const def = findRequest?.(c.requestId);
    return def ? requestPlaceholders(def) : null;
  };
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of tool.calls) {
      if (out.has(c.id) || c.id === callId) continue;
      const deps = callDependencies(c, placeholders(c));
      if (deps.includes(callId) || deps.some((d) => out.has(d))) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

/** The calls whose fields `callId` may read: not itself and not anything that waits on it (that would be a loop). */
export function sourceCalls(tool: Tool, callId: string, findRequest?: RequestLookup): ToolCall[] {
  const blocked = dependentCallIds(tool, callId, findRequest);
  return tool.calls.filter((c) => c.id !== callId && !blocked.has(c.id));
}

// ---- the Calls column ----

export interface CallGroup {
  label: string;
  calls: ToolCall[];
}

export type CallGroups = { ok: true; groups: CallGroup[] } | { ok: false; message: string; cycle: string[]; groups: CallGroup[] };

/** Calls in run order: "Step 1" holds the calls that need only inputs, "Step 2" the calls that need Step 1, and so on. */
export function callGroups(tool: Tool, findRequest: RequestLookup): CallGroups {
  const order = orderCalls(tool.calls, (c) => {
    const def = findRequest(c.requestId);
    return def ? requestPlaceholders(def) : null;
  });
  if (!order.ok) return { ok: false, message: order.message, cycle: order.cycle, groups: tool.calls.length ? [{ label: "Calls", calls: tool.calls }] : [] };
  return { ok: true, groups: order.levels.map((calls, i) => ({ label: `Step ${i + 1}`, calls })) };
}

export interface CallNeed {
  placeholder: string;
  /** Where the value comes from, in the order tried. "environment" when nothing is mapped. */
  from: { kind: SourceKind | "environment"; text: string }[];
}

function toolInputLabel(tool: Tool, name: string): string {
  const i = tool.inputs.find((x) => x.name === name);
  return i ? i.label || i.name : name;
}

/** What a call needs: each placeholder of its request and where it is filled from. Null when the request is missing. */
export function callNeeds(tool: Tool, call: ToolCall, findRequest: RequestLookup): CallNeed[] | null {
  const def = findRequest(call.requestId);
  if (!def) return null;
  return requestPlaceholders(def).map((placeholder) => {
    const m = call.mappings[placeholder];
    const from: CallNeed["from"] = [];
    if (m?.input !== undefined) from.push({ kind: "input", text: toolInputLabel(tool, m.input) });
    if (m?.call) {
      const src = tool.calls.find((c) => c.id === m.call!.callId);
      from.push({ kind: "call", text: src ? `${src.name}${m.call.path ? ` › ${m.call.path.replace(/^\$\.?/, "")}` : ""}` : "a removed call" });
    }
    if (m?.fixed !== undefined) from.push({ kind: "fixed", text: m.fixed === "" ? "(empty)" : m.fixed });
    if (from.length === 0) from.push({ kind: "environment", text: "environment" });
    return { placeholder, from };
  });
}

/** What a call gives: the labels of the fields blocks show from it, and the fields other calls read. */
export function callGives(tool: Tool, call: ToolCall): string[] {
  const out: string[] = [];
  for (const b of tool.blocks) {
    if (b.callId !== call.id || b.type === "action") continue;
    for (const f of b.fields) if (f.path.trim() && f.path !== "$") out.push(f.label || labelForPath(f.path));
    if (b.type === "json" && b.fields.length === 0) out.push("whole response");
  }
  for (const c of tool.calls) for (const m of Object.values(c.mappings)) if (m.call?.callId === call.id && m.call.path) out.push(m.call.path.replace(/^\$\.?/, ""));
  return [...new Set(out)];
}

// ---- tool inputs ----

export function addInput(tool: Tool): { tool: Tool; input: ToolInput } {
  const name = uniqueName("input", tool.inputs.map((i) => i.name));
  const input: ToolInput = { name, label: name, kind: "text" };
  return { tool: { ...tool, inputs: [...tool.inputs, input] }, input };
}

/** Changes an input. Renaming it keeps the calls and blocks that use it pointing at it. */
export function updateInput(tool: Tool, name: string, patch: Partial<ToolInput>): Tool {
  const inputs = tool.inputs.map((i) => {
    if (i.name !== name) return i;
    const next: ToolInput = { ...i, ...patch };
    if (next.kind === "dropdown" && !next.options) next.options = [];
    if (next.kind === "text") delete next.options;
    return next;
  });
  if (patch.name === undefined || patch.name === name) return { ...tool, inputs };
  const to = patch.name;
  return {
    ...tool,
    inputs,
    calls: tool.calls.map((c) => {
      if (!Object.values(c.mappings).some((m) => m.input === name)) return c;
      return { ...c, mappings: Object.fromEntries(Object.entries(c.mappings).map(([k, m]) => [k, m.input === name ? { ...m, input: to } : m])) };
    }),
    blocks: tool.blocks.map((b) => (b.inputName === name ? { ...b, inputName: to } : b)),
  };
}

/** Removes an input. What used it falls back: mappings lose the input source, input blocks lose their input. */
export function removeInput(tool: Tool, name: string): Tool {
  return {
    ...tool,
    inputs: tool.inputs.filter((i) => i.name !== name),
    calls: tool.calls.map((c) => {
      if (!Object.values(c.mappings).some((m) => m.input === name)) return c;
      const mappings: Record<string, PlaceholderMapping> = {};
      for (const [k, m] of Object.entries(c.mappings)) {
        if (m.input !== name) mappings[k] = m;
        else {
          const rest = without(m, "input");
          if (!isEmptyMapping(rest)) mappings[k] = rest;
        }
      }
      return { ...c, mappings };
    }),
    blocks: tool.blocks.map((b) => (b.inputName === name ? without(b, "inputName") : b)),
  };
}

/** Options typed one per line or separated by commas. */
export function parseOptions(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
}

// ---- JSON paths and the sample tree ----

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;

/** Whether readPath can read a path to this key. Keys holding `]` or both kinds of quote cannot be written as a path. */
export function keyIsPathSafe(key: string): boolean {
  if (PLAIN_KEY.test(key)) return true;
  if (key.includes("]")) return false;
  return !(key.includes('"') && key.includes("'"));
}

/** The path to a child: `$.name`, `$.items[0]`, `$["first name"]`. Compatible with readPath. */
export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  if (PLAIN_KEY.test(key)) return `${parent}.${key}`;
  return key.includes('"') ? `${parent}['${key}']` : `${parent}["${key}"]`;
}

export type TreeKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface TreeNode {
  /** Path from the root of the sample ("$"). */
  path: string;
  key: string;
  kind: TreeKind;
  /** Short text of a plain value, or the size of an object or list. */
  preview: string;
  /** Can be clicked to pick: false for keys that cannot be written as a path. */
  pickable: boolean;
  children: TreeNode[];
  /** For a list: how many items there are in all (only the first few are shown). */
  total?: number;
}

export const TREE_LIST_ITEMS = 3;
export const TREE_MAX_DEPTH = 8;

function kindOf(v: unknown): TreeKind {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "object":
      return "object";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

function previewOf(v: unknown, kind: TreeKind): string {
  switch (kind) {
    case "object":
      return `{${Object.keys(v as object).length}}`;
    case "array":
      return `[${(v as unknown[]).length}]`;
    case "null":
      return "null";
    case "string": {
      const s = String(v);
      return JSON.stringify(s.length > 48 ? `${s.slice(0, 47)}…` : s);
    }
    default:
      return String(v);
  }
}

/** A sample value as a tree to click. Lists show their first few items; deeper than TREE_MAX_DEPTH is not shown. */
export function buildTree(value: unknown, path = "$", key = "$", depth = 0, pickable = true): TreeNode {
  const kind = kindOf(value);
  const node: TreeNode = { path, key, kind, preview: previewOf(value, kind), pickable, children: [] };
  if (depth >= TREE_MAX_DEPTH) return node;
  if (kind === "array") {
    const list = value as unknown[];
    node.total = list.length;
    node.children = list.slice(0, TREE_LIST_ITEMS).map((item, i) => buildTree(item, childPath(path, i), `[${i}]`, depth + 1));
  } else if (kind === "object") {
    node.children = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
      const safe = keyIsPathSafe(k);
      return buildTree(v, safe ? childPath(path, k) : path, k, depth + 1, safe);
    });
  }
  return node;
}

/** The paths of lists in a response (up to two levels down), for choosing which list a table or "pick a row" reads. "$" is the response itself. */
export function listPathOptions(json: unknown): string[] {
  if (Array.isArray(json)) return ["$"];
  const out: string[] = [];
  if (json && typeof json === "object") {
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (!keyIsPathSafe(k)) continue;
      const p = childPath("$", k);
      if (Array.isArray(v)) out.push(p);
      else if (v && typeof v === "object") {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(v2) && keyIsPathSafe(k2)) out.push(childPath(p, k2));
      }
    }
  }
  return out;
}

/** A good label to show when picking a row: the first of name, title, label, number, id, else the first text value. */
export function guessLabelPath(row: unknown): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "";
  const entries = Object.entries(row as Record<string, unknown>).filter(([k]) => keyIsPathSafe(k));
  for (const want of ["name", "title", "label", "number", "id"]) {
    const hit = entries.find(([k, v]) => k.toLowerCase() === want && (typeof v === "string" || typeof v === "number"));
    if (hit) return childPath("$", hit[0]);
  }
  const text = entries.find(([, v]) => typeof v === "string");
  return text ? childPath("$", text[0]) : "";
}

/** "autoPay" and "auto_pay" become "Auto pay". */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

function nameSteps(path: string): string[] {
  try {
    return parsePath(path).filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

/** A label for a path: the last name in it, turned into words. */
export function labelForPath(path: string): string {
  const names = nameSteps(path);
  return names.length ? humanize(names[names.length - 1]) : path.trim() || "Value";
}

const MONEY_KEY = /(amount|price|balance|total|cost|fee|charge|monthly|due|revenue)/i;

/** The format that suits a sample value, as a starting point the builder can change. */
export function guessFormat(value: unknown, path: string): FieldFormat {
  if (typeof value === "boolean") return "yes-no";
  const last = nameSteps(path).pop() ?? "";
  if (typeof value === "number") return MONEY_KEY.test(last) ? "money" : "number";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  return "text";
}

// ---- picking fields ----

/** Block types that show exactly one field. */
export function isSingleField(type: BlockType): boolean {
  return type === "number" || type === "status" || type === "json";
}

/** Block types whose settings include fields picked from a response. */
export function usesFields(type: BlockType): boolean {
  return type === "fields" || type === "table" || isSingleField(type);
}

export function isPicked(block: ToolBlock, path: string): boolean {
  if (block.type === "json" && path === "$") return block.fields.length === 0 || block.fields[0].path.trim() === "" || block.fields[0].path === "$";
  return block.fields.some((f) => f.path === path);
}

function readSample(sample: unknown, path: string): unknown {
  let cur: unknown = sample;
  try {
    for (const step of parsePath(path)) {
      if (cur === null || cur === undefined) return undefined;
      cur = typeof step === "number" ? (Array.isArray(cur) ? cur[step < 0 ? cur.length + step : step] : undefined) : (cur as Record<string, unknown>)[step];
    }
  } catch {
    return undefined;
  }
  return cur;
}

function fieldFor(path: string, sample: unknown): BlockField {
  return { path, label: labelForPath(path), format: guessFormat(readSample(sample, path), path) };
}

/**
 * A click on a value in the sample. Fields and table add or remove the field; number, status and json take the one clicked
 * (clicking it again clears it; for json that means the whole response).
 */
export function togglePath(block: ToolBlock, path: string, sample: unknown): ToolBlock {
  if (block.type === "json") {
    if (path === "$" || block.fields[0]?.path === path) return { ...block, fields: [] };
    return { ...block, fields: [{ path, label: labelForPath(path), format: "text" }] };
  }
  const existing = block.fields.findIndex((f) => f.path === path);
  if (isSingleField(block.type)) {
    if (existing === 0 && block.fields.length === 1) return { ...block, fields: [] };
    return { ...block, fields: [fieldFor(path, sample)] };
  }
  if (existing >= 0) return { ...block, fields: block.fields.filter((_, i) => i !== existing) };
  return { ...block, fields: [...block.fields, fieldFor(path, sample)] };
}

/** Adds a field by hand, for a path typed in. Nothing changes for a path that is already there or is empty. */
export function addFieldByPath(block: ToolBlock, path: string, sample: unknown): ToolBlock {
  const p = path.trim();
  if (!p || block.fields.some((f) => f.path === p)) return block;
  return togglePath(block, p, sample);
}

export function updateField(block: ToolBlock, index: number, patch: Partial<BlockField>): ToolBlock {
  return { ...block, fields: block.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) };
}

export function removeField(block: ToolBlock, index: number): ToolBlock {
  return { ...block, fields: block.fields.filter((_, i) => i !== index) };
}

export function moveField(block: ToolBlock, from: number, to: number): ToolBlock {
  const t = Math.max(0, Math.min(block.fields.length - 1, to));
  if (from < 0 || from >= block.fields.length || from === t) return block;
  const fields = [...block.fields];
  const [f] = fields.splice(from, 1);
  fields.splice(t, 0, f);
  return { ...block, fields };
}

/** A call's sample for fields other calls read: the first row of a pick-a-row call's list (it is read from the picked row), else the response. */
export function sampleFor(call: ToolCall, result: CallResult | undefined): unknown {
  if (!result || result.state !== "done") return undefined;
  if (call.pickRow) return pickRows(call, result)?.[0];
  return callJson(result);
}

/** What the Connect dialog shows to click on: a table's first row (columns are paths inside a row), else the call's sample. */
export function blockSample(block: ToolBlock, call: ToolCall | undefined, result: CallResult | undefined): unknown {
  if (!call || !result || result.state !== "done") return undefined;
  if (block.type === "table") return tableRows(call, result)[0];
  return sampleFor(call, result);
}

/** The value a field shows in the sample, for hints next to a path. */
export function sampleValue(sample: unknown, path: string): unknown {
  return readSample(sample, path);
}

// ---- status colours ----

export interface ColourEntry {
  value: string;
  colour: BadgeColour;
}

/** The lines of a status block's text, in the order written. Lines that parseColourMap would not read are left out. */
export function colourEntries(text: string | undefined): ColourEntry[] {
  const out: ColourEntry[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const i = line.lastIndexOf("=");
    if (i < 1) continue;
    const colour = line.slice(i + 1).trim().toLowerCase() as BadgeColour;
    const value = line.slice(0, i).trim();
    if (BADGE_COLOURS.includes(colour) && value) out.push({ value, colour });
  }
  return out;
}

/** The text a status block keeps: one `value = colour` per line, the format parseColourMap reads. */
export function colourMapText(entries: readonly ColourEntry[]): string {
  return entries
    .filter((e) => e.value.trim() !== "" && !/[\r\n=]/.test(e.value))
    .map((e) => `${e.value.trim()} = ${e.colour}`)
    .join("\n");
}

// ---- the draft ----

export function toolsEqual(a: Tool, b: Tool): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether a draft has changes the saved tool does not. */
export function isDirty(saved: Tool | undefined, draft: Tool | undefined): boolean {
  return !!draft && !!saved && !toolsEqual(saved, draft);
}

/** The tool as it is kept on Save: rows counted without gaps, mappings of unused placeholders dropped. */
export function tidyTool(tool: Tool, findRequest: RequestLookup): Tool {
  return { ...pruneToolMappings(tool, findRequest), blocks: normalizeBlocks(tool.blocks) };
}

/** What stops a draft from being saved: errors such as a loop of calls. Warnings (a missing request) do not stop it. */
export function saveBlockers(tool: Tool, findRequest: RequestLookup): ToolProblem[] {
  return validateTool(tool, findRequest).filter((p) => p.level === "error");
}
