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
  /** Only for placeholders, and only when vars were given: whether a value exists for it. */
  resolved?: boolean;
}

// A {{name}} as written, or as it looks after URL encoding (%7B%7Bname%7D%7D).
const PLACEHOLDER_PARTS = /\{\{\s*[^{}]+?\s*\}\}|%7B%7B.+?%7D%7D/gi;

/** Splits text into plain runs and {{placeholder}} runs, so placeholders can be drawn in their own style. With `vars`, each placeholder also says whether it has a value. */
export function splitPlaceholders(text: string, vars?: Vars): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_PARTS)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), placeholder: false });
    const part: TextPart = { text: m[0], placeholder: true };
    if (vars) {
      let name = m[0].replace(/^\{\{|\}\}$/g, "");
      if (m[0].startsWith("%")) name = m[0].slice(6, -6);
      try {
        name = decodeURIComponent(name);
      } catch {
        // keep the raw text
      }
      part.resolved = Object.prototype.hasOwnProperty.call(vars, name.trim());
    }
    out.push(part);
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}

export type RequestSectionId = "params" | "auth" | "headers" | "body" | "scripts";

export interface SectionBarItem {
  id: RequestSectionId;
  label: string;
  /** A count (Params, Headers) or a dot (set up) for the chip; empty when the section has nothing. */
  mark: string;
}

/** The chips of the section bar under the URL: "Params 1 · Auth · Headers 3 · Body · Scripts •". */
export function sectionBarItems(def: RequestDef): SectionBarItem[] {
  const params = rowCounts(def.params).on;
  const headers = rowCounts(def.headers).on;
  return [
    { id: "params", label: "Params", mark: params ? String(params) : "" },
    { id: "auth", label: "Auth", mark: def.auth.type !== "none" ? "•" : "" },
    { id: "headers", label: "Headers", mark: headers ? String(headers) : "" },
    { id: "body", label: "Body", mark: def.bodyMode !== "none" ? "•" : "" },
    { id: "scripts", label: "Scripts", mark: (def.preScript ?? "").trim() || (def.postScript ?? "").trim() ? "•" : "" },
  ];
}

/**
 * Scroll-spy: the section the reader is in. `tops` are the sections' distances from the top of the
 * scrolling area, in order; the answer is the last one that has reached `offset`, or the first.
 */
export function activeSection<T extends string>(tops: { id: T; top: number }[], offset = 12): T | null {
  if (tops.length === 0) return null;
  let current = tops[0].id;
  for (const t of tops) if (t.top <= offset) current = t.id;
  return current;
}
