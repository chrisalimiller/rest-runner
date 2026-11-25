import { newId } from "../ids";
import { parsePath, readPath } from "../testing/jsonPath";
import { addBlock, childPath, groupRows, guessFormat, guessLabelPath, isSingleField, keyIsPathSafe, labelForPath, normalizeBlocks, sampleValue, uniqueName } from "./builder";
import { eachPlan, findList, listsToAsk, nameFromPath, readList, type ListSource } from "./lists";
import { newBlock } from "./tools";
import { MAX_BLOCKS_PER_ROW, type BlockField, type CallResult, type ItemRule, type ListItemChoice, type ListRef, type PlaceholderMapping, type Tool, type ToolBlock, type ToolCall, type ToolList } from "./types";

/**
 * The logic of setting up lists in Build mode, as plain functions over a tool: finding the lists in a sample response,
 * adding, changing and removing them, reading a click on a value inside a list as "this list, this field", and
 * the words that describe a rule. The screens in components/tools only call these.
 */

// ---- finding lists in a sample response ----

export interface FoundList {
  /** From the whole response, or (for a list inside a list item) from the item. */
  path: string;
  name: string;
  size: number;
  /** The first item, for a label path and field suggestions. */
  first: unknown;
  /** Lists inside the items of this one, found in its first item. */
  children: FoundList[];
}

const MAX_OBJECT_DEPTH = 3;
const MAX_LIST_DEPTH = 3;

function foundOf(path: string, arr: unknown[], listDepth: number): FoundList {
  const first = arr[0];
  const children = listDepth < MAX_LIST_DEPTH && first && typeof first === "object" && !Array.isArray(first) ? scan(first, "$", 1, listDepth + 1) : [];
  return { path, name: path === "$" ? "Items" : nameFromPath(path), size: arr.length, first, children };
}

function scan(value: unknown, base: string, depth: number, listDepth: number): FoundList[] {
  const out: FoundList[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!keyIsPathSafe(k)) continue;
    const p = childPath(base, k);
    if (Array.isArray(v)) out.push(foundOf(p, v, listDepth));
    else if (v && typeof v === "object" && depth < MAX_OBJECT_DEPTH) out.push(...scan(v, p, depth + 1, listDepth));
  }
  return out;
}

/** The lists in a response: up to three objects deep, and the lists inside the items of each (up to three lists deep). A response that is a list is "$". */
export function findLists(json: unknown): FoundList[] {
  if (Array.isArray(json)) return [foundOf("$", json, 1)];
  return scan(json, "$", 1, 1);
}

function normPath(p: string): string {
  const t = p.trim();
  return t === "$" ? "" : t;
}

export function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b);
}

/** A list of the call, and what the sample says about it (when it was found there). */
export interface ListNode {
  list: ToolList;
  found?: FoundList;
  children: ListNode[];
  /** Lists found inside this one's items that are not added yet. */
  suggestions: FoundList[];
}

export interface ListOutline {
  nodes: ListNode[];
  /** Lists found in the response that are not added yet. */
  suggestions: FoundList[];
}

/** The call's lists as a tree (lists inside lists below their parent), matched with what the sample response holds. */
export function listOutline(call: ToolCall, found: readonly FoundList[]): ListOutline {
  const lists = call.lists ?? [];
  const build = (parentId: string | undefined, candidates: readonly FoundList[]): { nodes: ListNode[]; suggestions: FoundList[] } => {
    const used = new Set<FoundList>();
    const nodes = lists
      .filter((l) => l.parentListId === parentId)
      .map((list): ListNode => {
        const match = candidates.find((f) => samePath(f.path, list.path));
        if (match) used.add(match);
        const inner = build(list.id, match?.children ?? []);
        return { list, ...(match ? { found: match } : {}), children: inner.nodes, suggestions: inner.suggestions };
      });
    return { nodes, suggestions: candidates.filter((f) => !used.has(f)) };
  };
  const roots = build(undefined, found);
  return { nodes: roots.nodes, suggestions: roots.suggestions };
}

// ---- adding, changing, removing ----

function updateCallLists(tool: Tool, callId: string, change: (lists: ToolList[]) => ToolList[]): Tool {
  return { ...tool, calls: tool.calls.map((c) => (c.id === callId ? { ...c, lists: change(c.lists ?? []) } : c)) };
}

function dropEmptyLists(tool: Tool, callId: string): Tool {
  return { ...tool, calls: tool.calls.map((c) => (c.id === callId && c.lists && c.lists.length === 0 ? withoutLists(c) : c)) };
}

function withoutLists(c: ToolCall): ToolCall {
  const copy = { ...c };
  delete copy.lists;
  return copy;
}

/** A new list from a list found in the sample. Not added to any call yet. */
export function listFromFound(call: ToolCall, found: FoundList, parentListId: string | undefined, choose: ItemRule): ToolList {
  const name = uniqueName(found.name, (call.lists ?? []).map((l) => l.name));
  return { id: newId(), name, path: found.path, ...(parentListId ? { parentListId } : {}), labelPath: guessLabelPath(found.first), choose };
}

/** Adds a list found in the sample to a call. A call with "ask me to pick a row" cannot have lists, so nothing changes then. */
export function addFoundList(tool: Tool, callId: string, found: FoundList, parentListId?: string, choose: ItemRule = { kind: "none" }): { tool: Tool; list: ToolList | null } {
  const call = tool.calls.find((c) => c.id === callId);
  if (!call || call.pickRow) return { tool, list: null };
  const list = listFromFound(call, found, parentListId, choose);
  return { tool: updateCallLists(tool, callId, (ls) => [...ls, list]), list };
}

/** Adds a list by hand, from a typed path. */
export function addListByPath(tool: Tool, callId: string, path: string, parentListId?: string): { tool: Tool; list: ToolList | null } {
  const p = path.trim();
  const call = tool.calls.find((c) => c.id === callId);
  if (!p || !call || call.pickRow) return { tool, list: null };
  const list: ToolList = { id: newId(), name: uniqueName(nameFromPath(p), (call.lists ?? []).map((l) => l.name)), path: p, ...(parentListId ? { parentListId } : {}), labelPath: "", choose: { kind: "none" } };
  return { tool: updateCallLists(tool, callId, (ls) => [...ls, list]), list };
}

export function updateList(tool: Tool, callId: string, listId: string, patch: Partial<ToolList>): Tool {
  return updateCallLists(tool, callId, (ls) => ls.map((l) => (l.id === listId ? { ...l, ...patch } : l)));
}

/** Removes a list and the lists inside it. What still reads them shows as a problem (unknown-list), and the lookup skips it with a reason. */
export function removeList(tool: Tool, callId: string, listId: string): Tool {
  const call = tool.calls.find((c) => c.id === callId);
  if (!call?.lists) return tool;
  const gone = new Set([listId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of call.lists) if (l.parentListId && gone.has(l.parentListId) && !gone.has(l.id)) (gone.add(l.id), (grew = true));
  }
  return dropEmptyLists(updateCallLists(tool, callId, (ls) => ls.filter((l) => !gone.has(l.id))), callId);
}

// ---- rules, in words ----

export type RuleKind = "none" | "ask" | "first" | "last" | "index" | "where";
export type ChoiceKind = Exclude<RuleKind, "none"> | "list" | "all" | "count" | "each";

export const RULE_LABELS: Record<RuleKind, string> = {
  none: "Show only",
  ask: "Ask me to pick",
  first: "First",
  last: "Last",
  index: "Row number",
  where: "First where…",
};

export const CHOICE_LABELS: Record<ChoiceKind, string> = {
  list: "Same as the list",
  ask: "The row I pick",
  first: "First",
  last: "Last",
  index: "Row number",
  where: "First where…",
  all: "All, joined",
  count: "How many",
  each: "Each item (one request per item)",
};

export const RULE_KINDS: readonly RuleKind[] = ["none", "ask", "first", "last", "index", "where"];
export const CHOICE_KINDS: readonly ChoiceKind[] = ["list", "ask", "first", "last", "index", "where", "all", "count", "each"];

export function ruleKind(r: ItemRule): RuleKind {
  if (r.kind === "index") return r.index === 0 ? "first" : r.index === -1 ? "last" : "index";
  return r.kind;
}

/** The rule of a kind. Switching between kinds keeps what fits (the condition of "where"); `field` suggests the field a new "where" compares. */
export function ruleOfKind(kind: RuleKind, prev?: ItemRule, field = ""): ItemRule {
  switch (kind) {
    case "none":
    case "ask":
      return { kind };
    case "first":
      return { kind: "index", index: 0 };
    case "last":
      return { kind: "index", index: -1 };
    case "index":
      return { kind: "index", index: prev?.kind === "index" && prev.index > 0 ? prev.index : 1 };
    case "where":
      return prev?.kind === "where" ? prev : { kind: "where", field, op: "eq", value: { fixed: "" } };
  }
}

export function choiceKind(c: ListItemChoice | undefined): ChoiceKind {
  // A table (rows) is only made by the Show as control of a Fields block entry, never by these editors.
  if (!c || c.kind === "none" || c.kind === "rows") return "list";
  if (c.kind === "all" || c.kind === "count" || c.kind === "each") return c.kind;
  return ruleKind(c) as ChoiceKind;
}

export function choiceOfKind(kind: ChoiceKind, prev: ListItemChoice | undefined, field = ""): ListItemChoice | undefined {
  switch (kind) {
    case "list":
      return undefined;
    case "all":
      return prev?.kind === "all" ? prev : { kind: "all", join: ", " };
    case "count":
      return prev?.kind === "count" ? prev : { kind: "count" };
    case "each":
      return { kind: "each" };
    default:
      return ruleOfKind(kind as RuleKind, prev && prev.kind !== "all" && prev.kind !== "count" && prev.kind !== "each" && prev.kind !== "rows" ? prev : undefined, field);
  }
}

// ---- a click on a value inside a list ----

export interface ListStep {
  /** Where this list is: from the whole response, or from the chosen item of the list before it. */
  path: string;
  /** Its first item. */
  first: unknown;
}

export interface ListPathSplit {
  /** The lists the path passes through, the outermost first. */
  lists: ListStep[];
  /** The rest of the path, read from an item of the last list ("$" for the item itself). */
  rest: string;
}

function stepsToPath(steps: readonly (string | number)[]): string {
  return steps.reduce<string>((p, s) => childPath(p, s), "$");
}

/**
 * Reads a path of a sample the way a click on a value inside a list should be taken: `$.devices[1].model` passes through the list
 * `$.devices` and is the field `$.model` of one of its items. Null when the path goes through no list (or does not fit the sample).
 */
export function splitListPath(json: unknown, path: string): ListPathSplit | null {
  let steps: (string | number)[];
  try {
    steps = parsePath(path);
  } catch {
    return null;
  }
  const lists: ListStep[] = [];
  let cur: unknown = json;
  let rel: (string | number)[] = [];
  for (const step of steps) {
    if (typeof step === "number") {
      if (!Array.isArray(cur)) return null;
      lists.push({ path: stepsToPath(rel), first: cur[0] });
      cur = cur[step < 0 ? cur.length + step : step];
      rel = [];
    } else {
      if (cur === null || cur === undefined || typeof cur !== "object") return null;
      cur = (cur as Record<string, unknown>)[step];
      rel.push(step);
    }
  }
  return lists.length > 0 ? { lists, rest: stepsToPath(rel) } : null;
}

/** The list of the call at the end of a chain of list steps, or undefined when one of them is not a list of the call yet. */
export function findListFor(call: ToolCall, lists: readonly ListStep[]): ToolList | undefined {
  let parent: string | undefined;
  let found: ToolList | undefined;
  for (const s of lists) {
    found = (call.lists ?? []).find((l) => samePath(l.path, s.path) && l.parentListId === parent);
    if (!found) return undefined;
    parent = found.id;
  }
  return found;
}

/**
 * Makes sure the call has the lists a click passed through (new ones are set to "ask me to pick"; an outer list that only
 * showed gets "ask" too, as an item has to be chosen to read inside it). Returns the reference to read the value through.
 */
export function ensureLists(tool: Tool, callId: string, steps: readonly ListStep[]): { tool: Tool; ref: ListRef } | null {
  let next = tool;
  let parent: string | undefined;
  let last: ToolList | undefined;
  let created = false;
  for (let i = 0; i < steps.length; i++) {
    const call = next.calls.find((c) => c.id === callId);
    if (!call || call.pickRow) return null;
    let list = (call.lists ?? []).find((l) => samePath(l.path, steps[i].path) && l.parentListId === parent);
    const isLast = i === steps.length - 1;
    if (!list) {
      const made = listFromFound(call, { path: steps[i].path, name: steps[i].path === "$" ? "Items" : nameFromPath(steps[i].path), size: 0, first: steps[i].first, children: [] }, parent, { kind: "ask" });
      next = updateCallLists(next, callId, (ls) => [...ls, made]);
      list = made;
      if (isLast) created = true;
    } else if (!isLast && list.choose.kind === "none") {
      next = updateList(next, callId, list.id, { choose: { kind: "ask" } });
      list = { ...list, choose: { kind: "ask" } };
    }
    parent = list.id;
    last = list;
  }
  if (!last) return null;
  // An existing list that only shows has no item to read from, so this value asks for the row.
  const ref: ListRef = !created && last.choose.kind === "none" ? { listId: last.id, item: { kind: "ask" } } : { listId: last.id };
  return { tool: next, ref };
}

/** The sample response of a call, as a click sees it. Undefined for a pick-a-row call, whose fields are read from the picked row. */
function clickable(call: ToolCall | undefined): boolean {
  return !!call && !call.pickRow;
}

export function sameRef(a: ListRef | undefined, b: ListRef | undefined): boolean {
  return a?.listId === b?.listId && (a === undefined) === (b === undefined);
}

/** A click in the sample on a value of another call, for a placeholder: the mapping reads it from the list item when it sits in a list. */
export function pickMappingPath(tool: Tool, callId: string, placeholder: string, sourceId: string, json: unknown, path: string): Tool {
  const source = tool.calls.find((c) => c.id === sourceId);
  const split = clickable(source) ? splitListPath(json, path) : null;
  let next = tool;
  let ref: ListRef | undefined;
  let value = path;
  if (split) {
    const ensured = ensureLists(tool, sourceId, split.lists);
    if (ensured) {
      next = ensured.tool;
      ref = ensured.ref;
      value = split.rest;
    }
  }
  return {
    ...next,
    calls: next.calls.map((c) => {
      if (c.id !== callId) return c;
      const current = c.mappings[placeholder] ?? {};
      return { ...c, mappings: { ...c.mappings, [placeholder]: { ...current, call: { callId: sourceId, path: value, ...(ref ? { list: ref } : {}) } } } };
    }),
  };
}

/** Whether a click target is the value a mapping reads now. */
export function mappingIsPicked(source: ToolCall | undefined, m: PlaceholderMapping, json: unknown, path: string): boolean {
  if (!m.call) return false;
  if (!m.call.list) return m.call.path === path;
  const split = clickable(source) ? splitListPath(json, path) : null;
  const list = source && split ? findListFor(source, split.lists) : undefined;
  return !!list && list.id === m.call.list.listId && samePath(split!.rest, m.call.path);
}

function sameField(f: BlockField, path: string, ref: ListRef | undefined): boolean {
  return f.path === path && f.list?.listId === ref?.listId;
}

/** Whether a click target is a field a block shows now. */
export function fieldIsPicked(call: ToolCall | undefined, block: ToolBlock, json: unknown, path: string): boolean {
  const split = clickable(call) ? splitListPath(json, path) : null;
  if (!split) return block.fields.some((f) => f.path === path && !f.list) || (!!call && !!entryOfPath(call, block, path));
  const list = call ? findListFor(call, split.lists) : undefined;
  return !!list && block.fields.some((f) => f.list?.listId === list.id && samePath(f.path, split.rest) && !showsWholeList(f));
}

/** A list entry that is about the whole list (how many, or plain values joined), not about one of its items. */
function showsWholeList(f: BlockField): boolean {
  const item = f.list?.item;
  return item?.kind === "count" || (item?.kind === "all" && samePath(f.path, "$"));
}

/**
 * A click in the sample on a field of a Fields, Number, Status or JSON block that sits in a list: adds (or removes) the field,
 * read from an item of that list. Null when the path is not inside a list, so the caller does what it did before.
 */
export function toggleListField(tool: Tool, blockId: string, json: unknown, path: string): Tool | null {
  const block = tool.blocks.find((b) => b.id === blockId);
  const call = tool.calls.find((c) => c.id === block?.callId);
  if (!block || !call || call.pickRow) return null;
  const split = splitListPath(json, path);
  if (!split) return null;
  const ensured = ensureLists(tool, call.id, split.lists);
  if (!ensured) return null;
  const { ref } = ensured;
  const at = block.fields.findIndex((f) => sameField(f, split.rest, ref));
  const made: BlockField = { path: split.rest, label: labelForPath(split.rest === "$" ? path : split.rest), format: guessFormat(sampleValue(json, path), split.rest), list: ref };
  let fields: BlockField[];
  if (block.type === "json") fields = at === 0 ? [] : [{ ...made, format: "text" }];
  else if (isSingleField(block.type)) fields = at === 0 && block.fields.length === 1 ? [] : [made];
  else fields = at >= 0 ? block.fields.filter((_, i) => i !== at) : [...block.fields, made];
  return { ...ensured.tool, blocks: ensured.tool.blocks.map((b) => (b.id === blockId ? { ...b, fields } : b)) };
}

/** The first keys of an item as paths, for suggesting the field of a "where". */
export function itemFieldOptions(item: unknown): string[] {
  if (!item || typeof item !== "object" || Array.isArray(item)) return [];
  return Object.keys(item as Record<string, unknown>)
    .filter(keyIsPathSafe)
    .map((k) => childPath("$", k));
}

/** The sample items of a list of the call, from a sample response. */
export function sampleItems(src: ListSource, listId: string): unknown[] {
  const r = readList(src, listId);
  return r.ok ? r.items : [];
}

/** The value of a path inside the first item of a sample, for hints. */
export function firstItemValue(items: readonly unknown[], path: string): unknown {
  return items.length > 0 ? readPath(items[0], path) : undefined;
}

// ---- a list the user is asked to pick in needs a table to pick in ----

/** Whether a table block of the tool shows this list (in Use mode, that table is where its row is picked). */
export function listHasTable(tool: Tool, callId: string, listId: string): boolean {
  return tool.blocks.some((b) => b.type === "table" && b.callId === callId && b.listId === listId);
}

/** Whether a lookup would wait for a pick in this list that no table lets the user make. */
export function pickHasNoTable(tool: Tool, call: ToolCall, listId: string): boolean {
  return listsToAsk(tool, call).includes(listId) && !listHasTable(tool, call.id, listId);
}

/** Adds a table block, as a row of its own at the end of the page, that shows the list (with the label as its one column). */
export function addListTable(tool: Tool, callId: string, listId: string): Tool {
  const call = tool.calls.find((c) => c.id === callId);
  const list = call?.lists?.find((l) => l.id === listId);
  if (!call || !list) return tool;
  const fields: BlockField[] = list.labelPath.trim() ? [{ path: list.labelPath, label: labelForPath(list.labelPath), format: "text" }] : [];
  const block = newBlock("table", 0, { title: list.name, callId, listId, fields });
  return { ...tool, blocks: addBlock(tool.blocks, block) };
}

// ---- columns from a call that runs once per item ----

/** The calls that run once per item of one list of `callId`. Their answers can be columns of a table on that list. */
export function perItemCallsFor(tool: Tool, callId: string, listId: string | undefined): ToolCall[] {
  if (listId === undefined) return [];
  return tool.calls.filter((c) => {
    const plan = eachPlan(c);
    return !!plan && plan.sourceId === callId && plan.listId === listId;
  });
}

/** What to click on to add a column: the first item of a per-item call whose response is JSON. */
export function perItemSample(result: CallResult | undefined): unknown {
  for (const e of result?.each ?? []) {
    if (e.state !== "done" || !e.response) continue;
    try {
      return JSON.parse(e.response.body);
    } catch {
      // Not JSON: try the next item.
    }
  }
  return undefined;
}

/** Whether the table already has a column reading this path of this per-item call. */
export function perItemColumnPicked(block: ToolBlock, callId: string, path: string): boolean {
  return block.fields.some((f) => f.callId === callId && f.path === path);
}

/** A click on a value of a per-item call's sample: adds a column from it, or removes the column that is there. */
export function togglePerItemColumn(block: ToolBlock, callId: string, path: string, sample: unknown): ToolBlock {
  const at = block.fields.findIndex((f) => f.callId === callId && f.path === path);
  if (at >= 0) return { ...block, fields: block.fields.filter((_, i) => i !== at) };
  return { ...block, fields: [...block.fields, { path, label: labelForPath(path), format: guessFormat(sampleValue(sample, path), path), callId }] };
}

// ---- a click on a list row of a Fields block: how to show the list ----

/** How a list entry of a Fields block shows its list. "json" is today's plain field, kept as the last choice. */
export type ListShow = "joined" | "count" | "json";

/** What a field of a block is when it shows a whole list. Null for a field that shows one value. */
export interface ListEntry {
  show: ListShow;
  /** The list of the call. Missing for a plain (JSON) field, which has none. */
  list?: ToolList;
}

/** Block types a list entry can sit in: the ones that show fields read from the response (not a table's columns, not a JSON block). */
export function takesListEntries(type: ToolBlock["type"]): boolean {
  return type === "fields" || type === "number" || type === "status";
}

/** Whether a sample value is a list. */
function isList(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** The list a field shows as a whole: joined, how many, or (for a saved plain field whose value is a list in the sample) as is. */
export function listEntryOf(call: ToolCall | undefined, f: BlockField, json: unknown): ListEntry | null {
  if (!call || f.callId !== undefined) return null;
  if (f.list) {
    const list = findList(call, f.list.listId);
    if (!list) return null;
    if (f.list.item?.kind === "count") return { show: "count", list };
    if (f.list.item?.kind === "all") return { show: "joined", list };
    return null;
  }
  return isList(sampleValue(json, f.path)) ? { show: "json" } : null;
}

function entryOfPath(call: ToolCall, block: ToolBlock, path: string): ListEntry | null {
  const list = topList(call, path);
  if (!list) return null;
  const f = block.fields.find((x) => x.list?.listId === list.id && (x.list.item?.kind === "count" || x.list.item?.kind === "all"));
  return f ? { show: f.list!.item!.kind === "count" ? "count" : "joined", list } : null;
}

/** The list of the call at this path of the whole response, if there is one. */
function topList(call: ToolCall, path: string): ToolList | undefined {
  return (call.lists ?? []).find((l) => !l.parentListId && samePath(l.path, path));
}

function listPathOf(f: BlockField, entry: ListEntry): string {
  return entry.list ? entry.list.path : f.path;
}

/** The list at this path of the call, made (set to show only, so nothing waits for a pick) when it is not there yet. */
function ensureShownList(tool: Tool, callId: string, json: unknown, path: string): { tool: Tool; list: ToolList } | null {
  const call = tool.calls.find((c) => c.id === callId);
  if (!call || call.pickRow) return null;
  const have = topList(call, path);
  if (have) return { tool, list: have };
  const value = sampleValue(json, path);
  const first = isList(value) ? value[0] : undefined;
  const list = listFromFound(call, { path, name: labelForPath(path), size: isList(value) ? value.length : 0, first, children: [] }, undefined, { kind: "none" });
  return { tool: updateCallLists(tool, callId, (ls) => [...ls, list]), list };
}

/** Whether anything still reads this list: a field, a table, a value of a request, a list inside it. */
function listIsUsed(tool: Tool, listId: string): boolean {
  const text = JSON.stringify(tool);
  return text.includes(`"listId":"${listId}"`) || text.includes(`"parentListId":"${listId}"`);
}

/** Takes away a list that was only made to show, and that nothing reads any more. A list the user set a rule on stays. */
function dropListIfUnused(tool: Tool, callId: string, listId: string | undefined): Tool {
  if (!listId) return tool;
  const list = tool.calls.find((c) => c.id === callId)?.lists?.find((l) => l.id === listId);
  if (!list || list.choose.kind !== "none" || listIsUsed(tool, listId)) return tool;
  return removeList(tool, callId, listId);
}

/** The key of an item that names it, as a path, or "$" for a list of plain values. */
function defaultKey(first: unknown): string {
  if (first === null || typeof first !== "object") return "$";
  const label = guessLabelPath(first);
  return label || itemFieldOptions(first)[0] || "$";
}

/** What a list is shown as when the click first adds it: joined for plain values, how many for records. */
export function defaultListShow(value: unknown): ListShow {
  const first = isList(value) ? value[0] : undefined;
  return first !== null && typeof first === "object" ? "count" : "joined";
}

function entryField(list: ToolList, show: Exclude<ListShow, "json">, prev: BlockField | undefined, first: unknown): BlockField {
  const where = prev?.list?.item?.kind === "count" || prev?.list?.item?.kind === "all" ? prev.list.item.where : undefined;
  const label = prev?.label || labelForPath(list.path);
  const keep = prev?.list?.item?.kind === "all" ? prev : undefined;
  if (show === "count") return { path: "$", label, format: "text", list: { listId: list.id, item: { kind: "count", ...(where ? { where } : {}) } } };
  return {
    path: keep?.path ?? defaultKey(first),
    label,
    format: "text",
    list: { listId: list.id, item: { kind: "all", join: keep?.list?.item?.kind === "all" ? keep.list.item.join : ", ", ...(where ? { where } : {}) } },
  };
}

function putField(block: ToolBlock, at: number, field: BlockField | null): ToolBlock {
  if (field === null) return { ...block, fields: block.fields.filter((_, i) => i !== at) };
  if (at >= 0) return { ...block, fields: block.fields.map((f, i) => (i === at ? field : f)) };
  return { ...block, fields: isSingleField(block.type) ? [field] : [...block.fields, field] };
}

function withBlock(tool: Tool, block: ToolBlock): Tool {
  return { ...tool, blocks: tool.blocks.map((b) => (b.id === block.id ? block : b)) };
}

/**
 * A click in the sample on a list row of a Fields, Number or Status block: adds the list as an entry (how many, or joined for
 * plain values), or takes the entry away when it is there. Null when the click is not on a list at the top of the response, or the
 * path is already a plain field (the caller does what it did before, so a saved plain field keeps its shape).
 */
export function toggleListEntry(tool: Tool, blockId: string, json: unknown, path: string): Tool | null {
  const block = tool.blocks.find((b) => b.id === blockId);
  const call = tool.calls.find((c) => c.id === block?.callId);
  if (!block || !call || call.pickRow || !takesListEntries(block.type)) return null;
  const value = sampleValue(json, path);
  if (!isList(value) || splitListPath(json, path)) return null;
  if (block.fields.some((f) => f.path === path && !f.list && f.callId === undefined)) return null;
  const have = entryOfPath(call, block, path);
  if (have?.list) {
    const at = block.fields.findIndex((f) => f.list?.listId === have.list!.id && (f.list.item?.kind === "count" || f.list.item?.kind === "all"));
    return dropListIfUnused(withBlock(tool, putField(block, at, null)), call.id, have.list.id);
  }
  const ensured = ensureShownList(tool, call.id, json, path);
  if (!ensured) return null;
  const show = defaultListShow(value);
  return withBlock(ensured.tool, putField(block, -1, entryField(ensured.list, show as Exclude<ListShow, "json">, undefined, value[0])));
}

/** Changes how an entry shows its list: joined, how many, or the plain field it was. Nothing else of the field changes. */
export function setListShow(tool: Tool, blockId: string, index: number, json: unknown, show: ListShow): Tool {
  const block = tool.blocks.find((b) => b.id === blockId);
  const call = tool.calls.find((c) => c.id === block?.callId);
  const f = block?.fields[index];
  if (!block || !call || !f) return tool;
  const entry = listEntryOf(call, f, json);
  if (!entry || entry.show === show) return tool;
  const path = listPathOf(f, entry);
  if (show === "json") {
    const plain: BlockField = { path, label: f.label, format: "text" };
    return dropListIfUnused(withBlock(tool, putField(block, index, plain)), call.id, entry.list?.id);
  }
  const ensured = ensureShownList(tool, call.id, json, path);
  if (!ensured) return tool;
  const value = sampleValue(json, path);
  return withBlock(ensured.tool, putField(block, index, entryField(ensured.list, show, entry.list ? f : { ...f, list: undefined }, isList(value) ? value[0] : undefined)));
}

/** Changes the item rule of an entry (the separator, the key it joins, the filter) without touching anything else. */
export function setEntryChoice(tool: Tool, blockId: string, index: number, patch: { path?: string; item?: Extract<ListItemChoice, { kind: "all" | "count" }> }): Tool {
  const block = tool.blocks.find((b) => b.id === blockId);
  const f = block?.fields[index];
  if (!block || !f?.list) return tool;
  const next: BlockField = { ...f, ...(patch.path !== undefined ? { path: patch.path } : {}), list: patch.item ? { listId: f.list.listId, item: patch.item } : f.list };
  return withBlock(tool, putField(block, index, next));
}

/**
 * "Its own Table block": adds a Table block on the entry's list, expandable, next to the block (in its row when there is room, else in a
 * row below). The entry becomes How many. Null when the list cannot be made.
 */
export function addTableBesideEntry(tool: Tool, blockId: string, index: number, json: unknown): { tool: Tool; tableId: string } | null {
  const block = tool.blocks.find((b) => b.id === blockId);
  const call = tool.calls.find((c) => c.id === block?.callId);
  const f = block?.fields[index];
  if (!block || !call || !f) return null;
  const entry = listEntryOf(call, f, json);
  if (!entry) return null;
  const counted = entry.show === "count" ? tool : setListShow(tool, blockId, index, json, "count");
  const list = (counted.calls.find((c) => c.id === call.id)?.lists ?? []).find((l) => (entry.list ? l.id === entry.list.id : samePath(l.path, f.path)));
  if (!list) return null;
  const columns: BlockField[] = list.labelPath.trim() ? [{ path: list.labelPath, label: labelForPath(list.labelPath), format: "text" }] : [];
  const table = newBlock("table", 0, { title: list.name, callId: call.id, listId: list.id, fields: columns, expandable: true });
  const rows = groupRows(normalizeBlocks(counted.blocks));
  const r = rows.findIndex((row) => row.some((b) => b.id === blockId));
  if (r < 0) return null;
  if (rows[r].length < MAX_BLOCKS_PER_ROW) rows[r].splice(rows[r].findIndex((b) => b.id === blockId) + 1, 0, table);
  else rows.splice(r + 1, 0, [table]);
  return { tool: { ...counted, blocks: rows.flatMap((row, i) => row.map((b) => ({ ...b, row: i }))) }, tableId: table.id };
}

/**
 * "One item's fields": takes the entry away, and says which item to open in the sample tree (the first one), so the next click
 * on a key reads it from an item, as a click inside a list does.
 */
export function openItemFields(tool: Tool, blockId: string, index: number, json: unknown): { tool: Tool; reveal: string } | null {
  const block = tool.blocks.find((b) => b.id === blockId);
  const call = tool.calls.find((c) => c.id === block?.callId);
  const f = block?.fields[index];
  if (!block || !call || !f) return null;
  const entry = listEntryOf(call, f, json);
  if (!entry) return null;
  const path = listPathOf(f, entry);
  return { tool: dropListIfUnused(withBlock(tool, putField(block, index, null)), call.id, entry.list?.id), reveal: childPath(path === "" ? "$" : path, 0) };
}
