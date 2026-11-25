import { findList } from "./lists";
import type { ItemRule, ListItemChoice, ListRef, PlaceholderMapping, Tool, ToolCall, ToolList } from "./types";

/** The words that describe lists, rules and where a value comes from. Pure, and with no imports from the builder, so both it and the screens can use it. */

/** The lists from the outermost to `listId` itself. */
export function listChain(call: ToolCall, listId: string): ToolList[] {
  const out: ToolList[] = [];
  let cur = findList(call, listId);
  while (cur && !out.includes(cur) && out.length < 8) {
    out.unshift(cur);
    cur = cur.parentListId ? findList(call, cur.parentListId) : undefined;
  }
  return out;
}

export function whereText(w: { field: string; op: "eq" | "ne"; value: PlaceholderMapping }, tool?: Tool): string {
  const field = w.field.replace(/^\$\.?/, "") || "item";
  const v = w.value;
  const value = v.fixed !== undefined ? (v.fixed === "" ? "(empty)" : v.fixed) : v.input !== undefined ? (tool?.inputs.find((i) => i.name === v.input)?.label ?? v.input) : v.call ? `${tool?.calls.find((c) => c.id === v.call!.callId)?.name ?? "a request"} › ${v.call.path.replace(/^\$\.?/, "")}` : "…";
  return `${field} ${w.op === "eq" ? "=" : "≠"} ${value}`;
}

/** "row you pick", "first", "last", "row 3", "first where status = active", "all joined with “, ”", "how many". */
export function choiceText(c: ItemRule | ListItemChoice, tool?: Tool): string {
  switch (c.kind) {
    case "none":
      return "no item chosen";
    case "ask":
      return "row you pick";
    case "index":
      return c.index === 0 ? "first" : c.index === -1 ? "last" : c.index > 0 ? `row ${c.index + 1}` : `${-c.index}th from the end`;
    case "where":
      return `first where ${whereText(c, tool)}`;
    case "all":
      return `all joined with “${c.join}”${c.where ? ` where ${whereText(c.where, tool)}` : ""}`;
    case "count":
      return `how many${c.where ? ` where ${whereText(c.where, tool)}` : ""}`;
    case "each":
      return "each item";
  }
}

/** The names a value passes on its way: the call, each list, the choice of item, the field. For the breadcrumb under a mapping or field. */
export function refBreadcrumb(tool: Tool, call: ToolCall | undefined, ref: ListRef | undefined, path: string): string[] {
  const field = path.trim() === "" || path.trim() === "$" ? "" : path.replace(/^\$\.?/, "");
  if (!call) return ["a removed request", ...(field ? [field] : [])];
  if (!ref) return [call.name, ...(field ? [field] : [])];
  const list = findList(call, ref.listId);
  if (!list) return [call.name, "a removed list", ...(field ? [field] : [])];
  const chain = listChain(call, list.id).map((l) => l.name);
  const choice = ref.item ?? list.choose;
  return [call.name, ...chain, choiceText(choice, tool), ...(field ? [field] : [])];
}

