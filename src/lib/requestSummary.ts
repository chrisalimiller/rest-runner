import { findJsonProblem } from "./jsonFormat";
import { prepareRequest } from "./request";
import type { Vars } from "./template";
import type { AuthConfig, BodyMode, KeyValue, RequestDef } from "./types";

/** One-line summaries shown on collapsed request sections, so they don't have to be opened to check them. */

export interface RowCounts {
  on: number;
  off: number;
}

function namedRows(rows: KeyValue[]): KeyValue[] {
  return rows.filter((r) => r.key.trim() !== "");
}

export function rowCounts(rows: KeyValue[]): RowCounts {
  const named = namedRows(rows);
  const on = named.filter((r) => r.enabled).length;
  return { on, off: named.length - on };
}

/** "3 on · 1 off", "3 on", or "" when there are no rows. */
export function countsLabel({ on, off }: RowCounts): string {
  if (on === 0 && off === 0) return "";
  return off > 0 ? `${on} on · ${off} off` : `${on} on`;
}

/** Enabled params as they read in a URL, before placeholders are filled: "a=1&b={{x}}". */
export function paramsText(rows: KeyValue[]): string {
  return namedRows(rows)
    .filter((r) => r.enabled)
    .map((r) => (r.value === "" ? r.key.trim() : `${r.key.trim()}=${r.value}`))
    .join("&");
}

/** Enabled headers as "Name: value · Name: value", before placeholders are filled. */
export function headersText(rows: KeyValue[]): string {
  return namedRows(rows)
    .filter((r) => r.enabled)
    .map((r) => `${r.key.trim()}: ${r.value}`)
    .join(" · ");
}

export const AUTH_LABELS: Record<AuthConfig["type"], string> = {
  none: "None",
  bearer: "Bearer",
  basic: "Basic",
  apikey: "API key",
};

/** The auth type and the one value worth seeing at a glance (token, username or key name). */
export function authSummary(auth: AuthConfig): { label: string; value: string } {
  switch (auth.type) {
    case "bearer":
      return { label: AUTH_LABELS.bearer, value: auth.token };
    case "basic":
      return { label: AUTH_LABELS.basic, value: auth.username };
    case "apikey":
      return { label: `${AUTH_LABELS.apikey} in ${auth.addTo === "header" ? "header" : "query"}`, value: auth.key };
    default:
      return { label: AUTH_LABELS.none, value: "" };
  }
}

export const BODY_LABELS: Record<BodyMode, string> = {
  none: "None",
  json: "Raw JSON",
  text: "Raw text",
  urlencoded: "Form (urlencoded)",
};

/** Body mode plus "Valid" / "Invalid JSON" for JSON bodies. */
export function bodySummary(def: Pick<RequestDef, "bodyMode" | "body">): { label: string; status: "valid" | "invalid" | null } {
  const label = BODY_LABELS[def.bodyMode];
  if (def.bodyMode !== "json" || def.body.trim() === "") return { label, status: null };
  return { label, status: findJsonProblem(def.body) ? "invalid" : "valid" };
}

/** "Params 1 · Bearer · Headers 3 · JSON body", used on a Testing case. */
export function requestSummaryLine(def: RequestDef): string {
  const parts: string[] = [];
  const params = rowCounts(def.params).on;
  if (params) parts.push(`Params ${params}`);
  if (def.auth.type !== "none") parts.push(AUTH_LABELS[def.auth.type]);
  const headers = rowCounts(def.headers).on;
  if (headers) parts.push(`Headers ${headers}`);
  const body: Record<BodyMode, string> = { none: "", json: "JSON body", text: "Text body", urlencoded: "Form body" };
  if (body[def.bodyMode]) parts.push(body[def.bodyMode]);
  return parts.length ? parts.join(" · ") : "No params, auth, headers or body";
}

/** The URL that Send will use: environment values and enabled query params filled in, exactly as prepareRequest builds it. */
export function resolvedUrl(def: RequestDef, vars: Vars): string {
  if (def.url.trim() === "") return "";
  try {
    return prepareRequest(def, vars).url;
  } catch {
    return def.url;
  }
}

export interface TextPart {
  text: string;
  placeholder: boolean;
  /** Only for placeholders: the variable name, decoded and trimmed. */
  name?: string;
  /** Only for placeholders, and only when vars were given: whether a value exists for it. */
  resolved?: boolean;
}

// A {{name}} as written, or as it looks after URL encoding (%7B%7Bname%7D%7D).
const PLACEHOLDER_PARTS = /\{\{\s*[^{}]+?\s*\}\}|%7B%7B.+?%7D%7D/gi;

/** A fresh global matcher for placeholders as the app recognises them, for code that scans text itself. */
export const placeholderPattern = (): RegExp => new RegExp(PLACEHOLDER_PARTS.source, "gi");

/** The variable name inside a placeholder as written: `{{ token }}` or `%7B%7Btoken%7D%7D`. */
export function placeholderName(raw: string): string {
  let name = raw.startsWith("%") ? raw.slice(6, -6) : raw.replace(/^\{\{|\}\}$/g, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw text
  }
  return name.trim();
}

/** The placeholder the caret is in or touching (`offset` is a caret position), with its start, end and position among the placeholders of the text. */
export function placeholderAt(text: string, offset: number): { name: string; from: number; to: number; index: number } | null {
  let index = 0;
  for (const m of text.matchAll(PLACEHOLDER_PARTS)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (offset >= from && offset <= to) return { name: placeholderName(m[0]), from, to, index };
    index++;
  }
  return null;
}

/** Splits text into plain runs and {{placeholder}} runs, so placeholders can be drawn in their own style. With `vars`, each placeholder also says whether it has a value. */
export function splitPlaceholders(text: string, vars?: Vars): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_PARTS)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), placeholder: false });
    const name = placeholderName(m[0]);
    const part: TextPart = { text: m[0], placeholder: true, name };
    if (vars) part.resolved = Object.prototype.hasOwnProperty.call(vars, name);
    out.push(part);
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}

export type DetailsTab = "params" | "auth" | "headers" | "scripts";

export const DETAILS_TABS: readonly DetailsTab[] = ["params", "auth", "headers", "scripts"];

export interface DetailsItem {
  id: DetailsTab;
  text: string;
  /** "missing" when the text holds a {{placeholder}} that has no value. */
  tone?: "missing";
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The items of the summary line under the URL: "1 param · Bearer {{token}} · 3 headers · after-script".
 * Disabled and unnamed rows are not counted. With `vars`, an auth value whose placeholder has no value is marked missing.
 * Scripts is left out when the request has none.
 */
export function requestDetailsSummary(def: RequestDef, vars?: Vars): DetailsItem[] {
  const params = rowCounts(def.params).on;
  const headers = rowCounts(def.headers).on;
  const auth = authSummary(def.auth);
  const authText = auth.value ? `${auth.label} ${auth.value}` : auth.label === AUTH_LABELS.none ? "No auth" : auth.label;
  const missing = !!vars && splitPlaceholders(authText, vars).some((p) => p.placeholder && p.resolved === false);
  const pre = (def.preScript ?? "").trim() !== "";
  const post = (def.postScript ?? "").trim() !== "";
  const items: DetailsItem[] = [
    { id: "params", text: params ? plural(params, "param") : "No params" },
    { id: "auth", text: authText, ...(missing ? { tone: "missing" as const } : {}) },
    { id: "headers", text: headers ? plural(headers, "header") : "No headers" },
  ];
  if (pre || post) items.push({ id: "scripts", text: pre && post ? "both scripts" : pre ? "before-script" : "after-script" });
  return items;
}

export interface DetailsState {
  open: boolean;
  tab: DetailsTab;
}

/** What was remembered about the Request details drawer, with anything unreadable or unknown replaced by closed on Params. */
export function loadDetailsState(raw: unknown): DetailsState {
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tab = DETAILS_TABS.find((t) => t === r.tab) ?? "params";
  return { open: r.open === true, tab };
}
