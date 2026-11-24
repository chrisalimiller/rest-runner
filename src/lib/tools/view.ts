import { formatMs } from "../flows/flows";
import type { RequestLookup } from "../flows/flows";
import { prettyBody } from "../format";
import { requestPlaceholders } from "../request";
import { readPath } from "../testing/jsonPath";
import type { RequestDef } from "../types";
import { callData, callJson, listSource, pickRows, readCallField } from "./engine";
import { chooseItem, listItems, listNote, type ValueResolver } from "./lists";
import type { BlockField, CallResult, FieldFormat, Tool, ToolBlock, ToolCall } from "./types";

/** What Use mode shows for tool blocks, worked out as plain data so it can be tested without a screen. */

export const NO_VALUE = "—";

function isNumeric(v: unknown): v is number | string {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));
}

function plain(v: unknown): string {
  if (v === undefined || v === null || v === "") return NO_VALUE;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}

function asDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Seconds since 1970 are far smaller than milliseconds.
    const d = new Date(Math.abs(v) < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    // A date with no time is a calendar day, not midnight UTC (which would read as the day before west of Greenwich).
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** A value as text in the chosen format. Anything that does not fit the format is shown as it is. */
export function formatFieldValue(value: unknown, format: FieldFormat): string {
  if (value === undefined || value === null || value === "") return NO_VALUE;
  switch (format) {
    case "number":
      return isNumeric(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 }) : plain(value);
    case "money":
      return isNumeric(value) ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : plain(value);
    case "date": {
      const d = asDate(value);
      if (!d) return plain(value);
      const hasTime = typeof value === "number" || /[T ]\d{2}:\d{2}/.test(String(value));
      return hasTime ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
    }
    case "yes-no": {
      if (value === true || value === 1) return "Yes";
      if (value === false || value === 0) return "No";
      const s = String(value).trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(s)) return "Yes";
      if (["false", "no", "n", "0"].includes(s)) return "No";
      return plain(value);
    }
    default:
      return plain(value);
  }
}

/** The method and the part of the address after the host, placeholders left as typed: "GET /subscribers/{{subscriberId}}". */
export function requestLine(def: RequestDef | null): { method: string; path: string } | null {
  if (!def) return null;
  let url = def.url.trim();
  url = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  // A base address kept in a variable: {{baseUrl}}/path.
  url = url.replace(/^\{\{[^}]+\}\}(?=[/?#]|$)/, "");
  if (url === "") url = "/";
  else if (!url.startsWith("/") && !url.startsWith("?") && !url.startsWith("{{")) url = `/${url}`;
  return { method: def.method, path: url };
}

// ---- what a call looks like ----

export type CallView =
  /** No lookup yet. */
  | { kind: "idle" }
  /** A lookup is running and this call has not started or finished. */
  | { kind: "waiting" }
  | { kind: "running" }
  | { kind: "ok"; status: number; ms?: number }
  | { kind: "http-error"; status: number; ms?: number }
  | { kind: "skipped"; message: string; missingRequest: boolean }
  | { kind: "network-error"; message: string }
  | { kind: "stopped" };

export interface CallViewInput {
  result: CallResult | undefined;
  /** The call has been sent and has not finished. */
  sending: boolean;
  /** A lookup is running. */
  lookingUp: boolean;
}

export function callView({ result, sending, lookingUp }: CallViewInput): CallView {
  if (!result) return sending ? { kind: "running" } : lookingUp ? { kind: "waiting" } : { kind: "idle" };
  switch (result.state) {
    case "done": {
      const status = result.status ?? result.response?.status ?? 0;
      const ms = result.durationMs ?? result.response?.durationMs;
      return status >= 400 ? { kind: "http-error", status, ms } : { kind: "ok", status, ms };
    }
    case "skipped":
      return { kind: "skipped", message: result.message ?? "Skipped", missingRequest: result.reason === "missing-request" };
    case "network-error":
      return { kind: "network-error", message: result.error ?? "No response" };
    case "stopped":
      return { kind: "stopped" };
  }
}

/** The short status in a block's header, e.g. "200 · 120 ms", "Skipped", "No response". Empty for idle. */
export function statusLabel(v: CallView): string {
  switch (v.kind) {
    case "ok":
    case "http-error":
      return v.ms === undefined ? String(v.status) : `${v.status} · ${formatMs(v.ms)}`;
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "skipped":
      return v.missingRequest ? "Request missing" : "Skipped";
    case "network-error":
      return "No response";
    case "stopped":
      return "Stopped";
    default:
      return "";
  }
}

export type StatusTone = "ok" | "bad" | "warn" | "muted" | "accent";

export function statusTone(v: CallView): StatusTone {
  switch (v.kind) {
    case "ok":
      return "ok";
    case "http-error":
    case "network-error":
      return "bad";
    case "skipped":
      return "warn";
    case "running":
      return "accent";
    default:
      return "muted";
  }
}

/** Whether Retry is offered: the call ended without a usable answer because of the server or the network. */
export function canRetry(v: CallView): boolean {
  return v.kind === "http-error" || v.kind === "network-error";
}

// ---- block content ----

export interface FieldRow {
  label: string;
  value: string;
}

/** Label and formatted value of each field of a "fields" block. */
export function fieldRows(block: ToolBlock, call: ToolCall, result: CallResult | undefined, resolve?: ValueResolver): FieldRow[] {
  return block.fields.map((f) => ({ label: f.label || f.path, value: formatFieldValue(readCallField(call, result, f.path, f.list, resolve), f.format) }));
}

/**
 * The list a table block shows. With `listId`, that list of the call. Otherwise a pick-a-row call uses its list path;
 * else the response itself, or its first list.
 */
export function tableRows(call: ToolCall, result: CallResult | undefined, listId?: string, resolve?: ValueResolver): unknown[] {
  if (!result || result.state !== "done") return [];
  if (listId !== undefined) return listItems(listSource(call, result, resolve), listId);
  const picked = pickRows(call, result);
  if (picked) return picked;
  if (call.pickRow) return [];
  const json = callJson(result);
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const list = Object.values(json).find((v) => Array.isArray(v));
    if (Array.isArray(list)) return list;
  }
  return [];
}

export interface TableView {
  columns: string[];
  rows: string[][];
  /** The row the lookup used: the picked row of a pick-a-row call, or the item the table's list hands on. */
  pickedIndex: number | null;
  /** Only for a table on a list: "No devices", or why the list could not be read. Null when there are rows. */
  note?: string | null;
}

export function tableView(block: ToolBlock, call: ToolCall, result: CallResult | undefined, resolve?: ValueResolver): TableView {
  const cols: BlockField[] = block.fields;
  const rows = tableRows(call, result, block.listId, resolve).map((row) => cols.map((c) => formatFieldValue(readPath(row, c.path), c.format)));
  let pickedIndex = result?.picked?.index ?? null;
  let note: string | null = null;
  if (block.listId !== undefined && result?.state === "done") {
    const src = listSource(call, result, resolve);
    // The item the user picked in this list's table, else the one the list's own rule hands on.
    const pick = src.picks?.[block.listId];
    const chosen = chooseItem(src, block.listId);
    pickedIndex = pick && Number.isInteger(pick.index) && pick.index >= 0 && pick.index < rows.length ? pick.index : chosen.ok ? chosen.index : null;
    note = rows.length === 0 ? listNote(src, block.listId) : null;
  }
  return { columns: cols.map((c) => c.label || c.path), rows, pickedIndex, ...(block.listId !== undefined ? { note } : {}) };
}

export interface NumberView {
  value: string;
  unit: string;
}

/** A number block: the first field, the unit typed in the block's text. */
export function numberView(block: ToolBlock, call: ToolCall, result: CallResult | undefined, resolve?: ValueResolver): NumberView {
  const f = block.fields[0];
  return { value: f ? formatFieldValue(readCallField(call, result, f.path, f.list, resolve), f.format === "text" ? "number" : f.format) : NO_VALUE, unit: block.text?.trim() ?? "" };
}

export type BadgeColour = "green" | "amber" | "red" | "blue" | "grey";
export const BADGE_COLOURS: readonly BadgeColour[] = ["green", "amber", "red", "blue", "grey"];

/**
 * The colour map of a status block is kept in its text, one `value = colour` per line:
 *   active = green
 *   suspended = red
 * Matching ignores case. Colours: green, amber, red, blue, grey.
 */
export function parseColourMap(text: string | undefined): Record<string, BadgeColour> {
  const out: Record<string, BadgeColour> = {};
  for (const line of (text ?? "").split(/\r?\n/)) {
    const i = line.lastIndexOf("=");
    if (i < 1) continue;
    const colour = line.slice(i + 1).trim().toLowerCase() as BadgeColour;
    if (BADGE_COLOURS.includes(colour)) out[line.slice(0, i).trim().toLowerCase()] = colour;
  }
  return out;
}

export interface StatusView {
  text: string;
  colour: BadgeColour;
}

export function statusBadgeView(block: ToolBlock, call: ToolCall, result: CallResult | undefined, resolve?: ValueResolver): StatusView {
  const f = block.fields[0];
  const raw = f ? readCallField(call, result, f.path, f.list, resolve) : undefined;
  const text = formatFieldValue(raw, f?.format ?? "text");
  const colour = parseColourMap(block.text)[text.toLowerCase()] ?? "grey";
  return { text, colour };
}

/** The JSON a json block shows: one path of the response, or the whole body (pretty-printed when it is JSON). */
export function jsonText(block: ToolBlock, call: ToolCall, result: CallResult | undefined, resolve?: ValueResolver): string {
  if (!result?.response) return "";
  const first = block.fields[0];
  const path = first?.path.trim();
  if (first?.list) {
    // A field in a list: no path (or $) is the whole item.
    const v = readCallField(call, result, path === "$" ? "" : (path ?? ""), first.list, resolve);
    return v === undefined ? "" : JSON.stringify(v, null, 2);
  }
  if (path && path !== "$") {
    const v = readCallField(call, result, path);
    return v === undefined ? "" : JSON.stringify(v, null, 2);
  }
  if (call.pickRow) {
    const v = callData(call, result);
    if (v !== undefined) return JSON.stringify(v, null, 2);
  }
  return prettyBody(result.response.body).text;
}

/** The response body as text, for Show raw response and Copy. */
export function rawResponseText(result: CallResult | undefined): string {
  if (!result) return "";
  if (result.response) return prettyBody(result.response.body).text;
  return result.error ?? result.message ?? "";
}

// ---- the whole lookup ----

/** How many calls are done and how many are running, for the line above the blocks. */
export function progressCounts(tool: Tool, results: Record<string, CallResult>, sending: readonly string[]): { done: number; running: number; total: number } {
  const lookups = tool.calls.filter((c) => !c.write);
  return { done: lookups.filter((c) => results[c.id]).length, running: sending.filter((id) => !results[id]).length, total: lookups.length };
}

/** Text for Copy all: each call's request and answer, one after the other. */
export function lookupAsText(tool: Tool, results: Record<string, CallResult>, findRequest: RequestLookup): string {
  const parts: string[] = [tool.name];
  for (const call of tool.calls) {
    if (call.write) continue;
    const r = results[call.id];
    if (!r) continue;
    const line = requestLine(findRequest(call.requestId));
    const head = `${call.name}${line ? ` (${line.method} ${line.path})` : ""} · ${statusLabel(callView({ result: r, sending: false, lookingUp: false }))}`;
    const body = r.state === "skipped" ? (r.message ?? "") : rawResponseText(r);
    const picked = picksText(call, r);
    const top = picked ? `${head}\nPicked ${picked}` : head;
    parts.push(body ? `${top}\n${body}` : top);
  }
  return parts.join("\n\n");
}

/** What was picked in each list of a call, as "Devices: iPhone 15; Services: Mobile". Empty when nothing was picked in a list. Pick-a-row calls are not covered. */
export function picksText(call: ToolCall, result: CallResult): string {
  const picks = result.picks;
  if (!picks) return "";
  return (call.lists ?? [])
    .filter((l) => picks[l.id])
    .map((l) => `${l.name}: ${picks[l.id].key ?? `row ${picks[l.id].index + 1}`}`)
    .join("; ");
}

/** The inputs of a saved lookup on one line: "subscriberId: 100234". */
export function inputsSummary(inputs: Record<string, string>): string {
  return Object.entries(inputs)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

/** Enter in a text input runs the lookup. Not while an input method is composing text. */
export function runsOnEnter(e: { key: string; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing;
}

/** Placeholder names the tool's calls leave to the environment (not filled by an input, another call or a fixed value), for the Variables panel. */
export function environmentNames(tool: Tool, findRequest: RequestLookup): string[] {
  const names = new Set<string>();
  for (const call of tool.calls) {
    const def = findRequest(call.requestId);
    if (!def) continue;
    for (const p of requestPlaceholders(def)) {
      const m = call.mappings[p];
      if (!(m && (m.input || m.call || m.fixed))) names.add(p);
    }
  }
  return [...names];
}
