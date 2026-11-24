import { newId } from "../ids";
import { readPath } from "../testing/jsonPath";
import type { BlockField, ItemRule, ListItemChoice, ListPick, ListRef, PlaceholderMapping, Tool, ToolCall, ToolList, Where } from "./types";

/**
 * Lists inside one call's response (a customer's services and devices): finding their items, choosing one item
 * by a rule, and reading a value through a ListRef. Everything here is a pure function of the parsed response,
 * the picks made so far and a way to resolve the value a "where" rule compares with.
 */

/** Longest chain of parent lists, and deepest chain of "where" values reading other lists. Stops a rule that loops back on itself. */
const MAX_DEPTH = 8;

/** A value as the text that goes into a request. Null for nothing there (missing, null, empty text). */
export function valueText(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}

/** The text a "where" rule compares with, or null when it is not known (yet). */
export type ValueResolver = (m: PlaceholderMapping) => string | null;

/** What reading a list needs to know about one call. */
export interface ListSource {
  call: ToolCall;
  /** The response body as JSON (undefined when there is none). */
  json: unknown;
  /** The items picked so far, by list id. */
  picks?: Record<string, ListPick>;
  resolve: ValueResolver;
}

export type ListFailureKind = "unknown-list" | "not-a-list" | "empty" | "no-item" | "not-picked" | "no-value" | "no-match" | "out-of-range";

/** Why a list could not give what was asked. `message` is ready to show. */
export interface ListFailure {
  ok: false;
  kind: ListFailureKind;
  message: string;
}

export type ItemsRead = { ok: true; items: unknown[] } | ListFailure;
export type ItemRead = { ok: true; index: number; item: unknown; items: unknown[] } | ListFailure;
export type ValueRead = { ok: true; value: unknown } | ListFailure;

export function findList(call: ToolCall, listId: string): ToolList | undefined {
  return call.lists?.find((l) => l.id === listId);
}

function normPath(p: string): string {
  const t = p.trim();
  return t === "$" ? "" : t;
}

function fail(kind: ListFailureKind, message: string): ListFailure {
  return { ok: false, kind, message };
}

/** "Services" to "service", for messages. */
function singular(name: string): string {
  const n = name.trim().toLowerCase();
  if (/[^aeiou]ies$/.test(n)) return `${n.slice(0, -3)}y`;
  if (n.endsWith("s") && !n.endsWith("ss") && n.length > 1) return n.slice(0, -1);
  return n;
}

function emptyFailure(call: ToolCall, list: ToolList): ListFailure {
  return fail("empty", `${call.name} has no ${list.name.trim().toLowerCase()}`);
}

/** Whether an item matches a "where" rule. "ne" also matches an item with no value there. */
export function matchesWhere(item: unknown, field: string, op: "eq" | "ne", value: string): boolean {
  const text = valueText(readPath(item, field));
  return op === "eq" ? text === value : (text ?? "") !== value;
}

function whereText(list: ToolList, field: string, op: "eq" | "ne", value: string, callName: string): string {
  return `No ${singular(list.name)} where ${field.replace(/^\$\.?/, "")} ${op === "eq" ? "=" : "≠"} ${value} in ${callName}`;
}

/** The items of a list. A list inside another list reads its path from the parent's chosen item. */
export function readList(src: ListSource, listId: string, depth = 0): ItemsRead {
  const list = findList(src.call, listId);
  if (!list) return fail("unknown-list", `${src.call.name}: a list that was removed is still used`);
  let base: unknown = src.json;
  if (list.parentListId) {
    if (depth >= MAX_DEPTH) return fail("unknown-list", `${list.name}: lists inside lists go round in a loop`);
    const parent = chooseItem(src, list.parentListId, undefined, depth + 1);
    if (!parent.ok) return parent;
    base = parent.item;
  }
  const items = readPath(base, normPath(list.path));
  return Array.isArray(items) ? { ok: true, items } : fail("not-a-list", `${list.name} is not a list in this response`);
}

/** The items of a list, empty when it cannot be read. */
export function listItems(src: ListSource, listId: string): unknown[] {
  const r = readList(src, listId);
  return r.ok ? r.items : [];
}

function validPick(src: ListSource, listId: string, count: number): number | null {
  const p = src.picks?.[listId];
  return p && Number.isInteger(p.index) && p.index >= 0 && p.index < count ? p.index : null;
}

/** The item a list hands on: by the list's own rule, or by `rule` when given. */
export function chooseItem(src: ListSource, listId: string, rule?: ItemRule, depth = 0): ItemRead {
  const read = readList(src, listId, depth);
  if (!read.ok) return read;
  const list = findList(src.call, listId)!;
  const items = read.items;
  const r = rule ?? list.choose;
  const at = (index: number): ItemRead => ({ ok: true, index, item: items[index], items });
  switch (r.kind) {
    case "none":
      return fail("no-item", `${list.name} only shows its items; no item is chosen`);
    case "ask": {
      if (items.length === 0) return emptyFailure(src.call, list);
      const picked = validPick(src, list.id, items.length);
      return picked === null ? fail("not-picked", `No row picked in ${list.name}`) : at(picked);
    }
    case "index": {
      if (items.length === 0) return emptyFailure(src.call, list);
      const i = r.index < 0 ? items.length + r.index : r.index;
      return Number.isInteger(i) && i >= 0 && i < items.length ? at(i) : fail("out-of-range", `${list.name} has no item ${r.index < 0 ? "from the end" : "at"} ${r.index}`);
    }
    case "where": {
      if (items.length === 0) return emptyFailure(src.call, list);
      const value = depth >= MAX_DEPTH ? null : src.resolve(r.value);
      if (value === null) return fail("no-value", `No value yet to look for in ${list.name}`);
      const i = items.findIndex((it) => matchesWhere(it, r.field, r.op, value));
      return i >= 0 ? at(i) : fail("no-match", whereText(list, r.field, r.op, value, src.call.name));
    }
  }
}

/** The items that match a "where" (all of them without one). */
function filtered(src: ListSource, listId: string, where: Where | undefined): ItemsRead {
  const read = readList(src, listId);
  if (!read.ok || !where) return read;
  const list = findList(src.call, listId)!;
  const value = src.resolve(where.value);
  if (value === null) return fail("no-value", `No value yet to look for in ${list.name}`);
  return { ok: true, items: read.items.filter((it) => matchesWhere(it, where.field, where.op, value)) };
}

/** The label of an item, from the list's label path (the whole item without one). Empty when there is nothing to show. */
export function itemLabel(list: ToolList, item: unknown): string {
  const path = list.labelPath.trim();
  return valueText(path ? readPath(item, path) : item) ?? "";
}

/** A pick of item `index`, with the label that lets a later lookup recognise the same row. */
export function pickOf(list: ToolList, items: readonly unknown[], index: number): ListPick {
  const key = itemLabel(list, items[index]);
  return key ? { index, key } : { index };
}

/**
 * The item of `items` that an earlier pick (from another lookup) points at: the one with the same label, preferring
 * the same position. Null when there was no pick, it has no label to go by, or no item has that label now.
 */
export function rememberedIndex(list: ToolList, items: readonly unknown[], prev: ListPick | undefined): number | null {
  const key = prev?.key;
  if (!prev || !key) return null;
  if (Number.isInteger(prev.index) && prev.index >= 0 && prev.index < items.length && itemLabel(list, items[prev.index]) === key) return prev.index;
  const i = items.findIndex((it) => itemLabel(list, it) === key);
  return i >= 0 ? i : null;
}

/** The ids of the lists that sit inside `listId`, at any depth. */
export function descendantListIds(call: ToolCall, listId: string): string[] {
  const out: string[] = [];
  const queue = [listId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const l of call.lists ?? []) {
      if (l.parentListId === id && !out.includes(l.id) && l.id !== listId) {
        out.push(l.id);
        queue.push(l.id);
      }
    }
  }
  return out;
}

/**
 * Reads `path` through a list reference: from the item the reference (or else the list) chooses, or from all
 * items joined, or the number of items. `ok` with an undefined value means the item has nothing at that path.
 */
export function readListValue(src: ListSource, path: string, ref: ListRef): ValueRead {
  const choice: ListItemChoice | undefined = ref.item;
  if (choice?.kind === "all" || choice?.kind === "count") {
    const list = findList(src.call, ref.listId);
    const read = filtered(src, ref.listId, choice.where);
    if (!read.ok) return read;
    if (choice.kind === "count") return { ok: true, value: read.items.length };
    if (read.items.length === 0) return list ? (choice.where ? fail("no-match", whereText(list, choice.where.field, choice.where.op, src.resolve(choice.where.value) ?? "", src.call.name)) : emptyFailure(src.call, list)) : fail("unknown-list", "A list was removed");
    const values = read.items.map((it) => valueText(readPath(it, path))).filter((v): v is string => v !== null);
    return { ok: true, value: values.length > 0 ? values.join(choice.join) : undefined };
  }
  const chosen = chooseItem(src, ref.listId, choice);
  return chosen.ok ? { ok: true, value: readPath(chosen.item, path) } : chosen;
}

/** What a table shows under or instead of its rows: "No devices", or why the list could not be read. Null when there are rows. */
export function listNote(src: ListSource, listId: string): string | null {
  const read = readList(src, listId);
  if (!read.ok) return read.kind === "empty" ? `No ${findList(src.call, listId)?.name.toLowerCase() ?? "items"}` : read.message;
  if (read.items.length > 0) return null;
  const list = findList(src.call, listId);
  return `No ${list ? list.name.trim().toLowerCase() : "items"}`;
}

// ---- what has to be finished before a value can be read ----

/** A call that has to have its response in, and the lists of it whose picks must be settled (picked or given up). */
export interface Need {
  callId: string;
  lists: string[];
}

function merge(needs: Need[]): Need[] {
  const byCall = new Map<string, Set<string>>();
  for (const n of needs) {
    const set = byCall.get(n.callId) ?? new Set<string>();
    n.lists.forEach((l) => set.add(l));
    byCall.set(n.callId, set);
  }
  return [...byCall].map(([callId, lists]) => ({ callId, lists: [...lists] }));
}

/** What evaluating a rule on a list needs: the pick for "ask", the compared value's sources for "where". */
function ruleNeeds(call: ToolCall, list: ToolList, rule: ItemRule | Where | undefined, calls: ReadonlyMap<string, ToolCall>, depth: number): Need[] {
  if (!rule) return [];
  if ("kind" in rule) {
    if (rule.kind === "ask") return [{ callId: call.id, lists: [list.id] }];
    if (rule.kind === "where") return mappingNeeds(rule.value, calls, depth + 1);
    return [];
  }
  return mappingNeeds(rule.value, calls, depth + 1);
}

/** What reading the items of a list needs: how each list it sits inside chooses its item. */
function chainNeeds(call: ToolCall, list: ToolList, calls: ReadonlyMap<string, ToolCall>, depth: number): Need[] {
  const out: Need[] = [];
  const seen = new Set<string>([list.id]);
  let parent = list.parentListId ? findList(call, list.parentListId) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    out.push(...ruleNeeds(call, parent, parent.choose, calls, depth));
    parent = parent.parentListId ? findList(call, parent.parentListId) : undefined;
  }
  return out;
}

/** What has to be finished before a placeholder mapping can be read. Reading the whole response needs only the call's response. */
export function mappingNeeds(m: PlaceholderMapping, calls: ReadonlyMap<string, ToolCall>, depth = 0): Need[] {
  if (!m.call || depth > MAX_DEPTH) return [];
  const source = calls.get(m.call.callId);
  const out: Need[] = [{ callId: m.call.callId, lists: [] }];
  const ref = m.call.list;
  const list = source && ref ? findList(source, ref.listId) : undefined;
  if (source && ref && list) {
    const choice = ref.item;
    const rule = choice === undefined ? list.choose : choice.kind === "all" || choice.kind === "count" ? choice.where : choice;
    out.push(...ruleNeeds(source, list, rule, calls, depth), ...chainNeeds(source, list, calls, depth));
  }
  return merge(out);
}

/** Everything a call has to wait for. Only placeholders in `only` count when given. */
export function callNeeds(call: ToolCall, only: readonly string[] | null | undefined, calls: ReadonlyMap<string, ToolCall>): Need[] {
  const out: Need[] = [];
  for (const [placeholder, m] of Object.entries(call.mappings)) {
    if (only && !only.includes(placeholder)) continue;
    out.push(...mappingNeeds(m, calls));
  }
  return merge(out);
}

/** What has to be finished before the items of one list of a call can be asked for (a list inside a list needs its parents' choices). */
export function listAskNeeds(call: ToolCall, listId: string, calls: ReadonlyMap<string, ToolCall>): Need[] {
  const list = findList(call, listId);
  return list ? merge(chainNeeds(call, list, calls, 0)) : [];
}

function* mappingsIn(m: PlaceholderMapping): Generator<PlaceholderMapping> {
  yield m;
  const choice = m.call?.list?.item;
  if (choice && (choice.kind === "where" || ((choice.kind === "all" || choice.kind === "count") && choice.where))) {
    const value = choice.kind === "where" ? choice.value : choice.where!.value;
    yield* mappingsIn(value);
  }
}

/** The ids of the lists of `call` the user is asked to pick in: lists whose own rule is "ask", and lists a value reads with the "ask" rule. */
export function listsToAsk(tool: Tool, call: ToolCall): string[] {
  if (!call.lists?.length) return [];
  const ids = new Set(call.lists.filter((l) => l.choose.kind === "ask").map((l) => l.id));
  const consider = (m: PlaceholderMapping) => {
    for (const x of mappingsIn(m)) if (x.call?.callId === call.id && x.call.list?.item?.kind === "ask") ids.add(x.call.list.listId);
  };
  for (const c of tool.calls) {
    Object.values(c.mappings).forEach(consider);
    for (const l of c.lists ?? []) if (l.choose.kind === "where") consider(l.choose.value);
  }
  for (const b of tool.blocks) {
    if (b.callId !== call.id) continue;
    for (const f of b.fields) if (f.list?.item?.kind === "ask") ids.add(f.list.listId);
  }
  return call.lists.filter((l) => ids.has(l.id)).map((l) => l.id);
}

// ---- tools that use lists ----

/** Whether a tool uses any list feature (so its export file must be version 2). */
export function toolUsesLists(tool: Tool): boolean {
  return (
    tool.calls.some((c) => (c.lists?.length ?? 0) > 0 || Object.values(c.mappings).some((m) => m.call?.list !== undefined)) ||
    tool.blocks.some((b) => b.listId !== undefined || b.fields.some((f) => f.list !== undefined))
  );
}

// ---- pick-a-row to lists ----

/** A name for the list made from a pick-a-row call: the last word of its path ("$.data.devices" is "Devices"). */
export function nameFromPath(path: string): string {
  const last = path.split(/[.[\]"']/).filter((p) => p !== "" && p !== "$" && !/^-?\d+$/.test(p)).pop();
  return last ? last.charAt(0).toUpperCase() + last.slice(1) : "Rows";
}

/**
 * Turns a pick-a-row call into one list set to "ask", and rewrites everything that reads from the call so it returns the
 * same values: the mappings of other calls and the fields of blocks. Nothing is written back by this function; the caller
 * puts the result in the Build draft. Returns the tool as it was when the call is not a pick-a-row call.
 */
export function convertPickRow(tool: Tool, callId: string): Tool {
  const call = tool.calls.find((c) => c.id === callId);
  if (!call?.pickRow || call.lists?.length) return tool;
  const listId = newId();
  const list: ToolList = { id: listId, name: nameFromPath(call.pickRow.listPath), path: call.pickRow.listPath, labelPath: call.pickRow.labelPath, choose: { kind: "ask" } };
  const ref: ListRef = { listId };

  const rewriteChoice = (c: ListItemChoice | undefined): ListItemChoice | undefined => {
    if (!c) return c;
    if (c.kind === "where") return { ...c, value: rewrite(c.value) };
    if ((c.kind === "all" || c.kind === "count") && c.where) return { ...c, where: { ...c.where, value: rewrite(c.where.value) } };
    return c;
  };
  const rewrite = (m: PlaceholderMapping): PlaceholderMapping => {
    if (!m.call) return m;
    if (m.call.callId === callId && !m.call.list) return { ...m, call: { ...m.call, list: ref } };
    if (!m.call.list?.item) return m;
    return { ...m, call: { ...m.call, list: { ...m.call.list, item: rewriteChoice(m.call.list.item) } } };
  };
  const rewriteField = (f: BlockField): BlockField => {
    if (!f.list?.item) return f;
    return { ...f, list: { ...f.list, item: rewriteChoice(f.list.item) } };
  };

  const calls = tool.calls.map((c) => {
    const mappings = Object.fromEntries(Object.entries(c.mappings).map(([k, m]) => [k, rewrite(m)]));
    const lists = c.lists?.map((l) => (l.choose.kind === "where" ? { ...l, choose: { ...l.choose, value: rewrite(l.choose.value) } } : l));
    if (c.id !== callId) return { ...c, mappings, ...(lists ? { lists } : {}) };
    const { pickRow: _legacy, ...rest } = c;
    return { ...rest, mappings, lists: [list] };
  });
  const blocks = tool.blocks.map((b) => {
    if (b.callId !== callId) return { ...b, fields: b.fields.map(rewriteField) };
    switch (b.type) {
      case "table":
        return { ...b, listId, fields: b.fields.map(rewriteField) };
      case "fields":
      case "number":
      case "status":
        return { ...b, fields: b.fields.map((f) => ({ ...f, list: ref })) };
      case "json":
        // Read from the picked row, as a json block with no path did.
        return { ...b, fields: b.fields.length > 0 ? b.fields.map((f) => ({ ...f, list: ref })) : [{ path: "$", label: "", format: "text" as const, list: ref }] };
      default:
        return { ...b, fields: b.fields.map(rewriteField) };
    }
  });
  return { ...tool, calls, blocks };
}
