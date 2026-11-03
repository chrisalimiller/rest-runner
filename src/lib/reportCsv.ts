import { certificateLabel } from "./certificates";
import { durationOf } from "./run";
import { maskSecrets } from "./secrets";
import type { SendOutcome } from "./types";

/** Quotes a cell when it holds a comma, quote, line break or edge space (RFC 4180). */
export function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One `Name: value` per line. */
export function headerLines(headers: [string, string][]): string {
  return headers.map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** The columns every CSV report uses to describe one call, in this order. */
export const CALL_COLUMNS = [
  "status",
  "status_text",
  "duration_ms",
  "sent_at",
  "method",
  "url",
  "request_headers",
  "request_body",
  "response_headers",
  "response_body",
  "response_size_bytes",
  "error",
  "certificate",
] as const;

/** Excel keeps 32,767 characters per cell and drops the rest without a word, so cells are cut a little under that. */
export const CELL_LIMIT = 32000;

export interface CsvOptions {
  /** Secret values to mask in every call cell, before the cell is cut. */
  secrets?: readonly string[];
}

/** Content types whose bodies are text. */
const TEXT_TYPE = /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|yaml|csv|graphql/i;

function headerValue(headers: [string, string][], name: string): string {
  return headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
}

/** True for an image, PDF, zip and the like: a non-text content type, or any NUL character. */
export function isBinaryBody(body: string, headers: [string, string][]): boolean {
  if (body.includes("\0")) return true;
  const type = headerValue(headers, "content-type").split(";")[0].trim();
  return type !== "" && !TEXT_TYPE.test(type);
}

/** The body for a report: itself, or a one-line note when it is binary and would print as garbage. */
export function reportBody(body: string, headers: [string, string][], sizeBytes?: number): string {
  if (!body || !isBinaryBody(body, headers)) return body;
  const type = headerValue(headers, "content-type").split(";")[0].trim();
  const bytes = sizeBytes ?? new TextEncoder().encode(body).length;
  return `(binary body: ${bytes.toLocaleString("en-US")} bytes${type ? `, ${type}` : ""})`;
}

/** Excel runs a cell that starts with = or @, or with + or - that is not a number, as a formula. A leading ' stops that. */
export function guardFormula(s: string): string {
  return /^(?:[=@]|[+-](?!\d))/.test(s) ? `'${s}` : s;
}

/** Cuts a cell to CELL_LIMIT characters and says how much was left out. */
export function cutCell(s: string, limit = CELL_LIMIT): string {
  if (s.length <= limit) return s;
  let end = limit;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not split a surrogate pair
  return `${s.slice(0, end)}… [cut: ${(s.length - end).toLocaleString("en-US")} more characters; the full body is in the HTML report]`;
}

/** Mask, then guard, then cut: a secret is never split by the cut, and the cut never hides the guard. */
function safeCell(s: string, secrets: readonly string[], guard: boolean): string {
  if (!s) return s;
  const masked = secrets.length ? maskSecrets(s, secrets) : s;
  return cutCell(guard ? guardFormula(masked) : masked);
}

/** The call's cells, matching CALL_COLUMNS. With no outcome the case never ran, so the status says so and the rest is empty. */
export function callCells(o: SendOutcome | null | undefined, options: CsvOptions = {}): (string | number)[] {
  if (!o) return ["Not sent", ...CALL_COLUMNS.slice(1).map(() => "")];
  const secrets = options.secrets ?? [];
  const res = o.ok ? o.response : null;
  const reqBody = o.request.body ?? "";
  return [
    res ? String(res.status) : "Error",
    res?.statusText ?? "",
    durationOf(o),
    o.sentAt,
    o.request.method,
    safeCell(o.request.url, secrets, true),
    safeCell(headerLines(o.request.headers), secrets, true),
    safeCell(reportBody(reqBody, o.request.headers), secrets, true),
    res ? safeCell(headerLines(res.headers), secrets, true) : "",
    res ? safeCell(reportBody(res.body, res.headers, res.sizeBytes), secrets, true) : "",
    res?.sizeBytes ?? "",
    o.ok ? "" : safeCell(o.error, secrets, true),
    certificateLabel(o.certificate),
  ];
}

/** Empty cells for rows that are not a call (a Set variable step, for example). */
export function emptyCallCells(): string[] {
  return CALL_COLUMNS.map(() => "");
}

/** A CSV file: BOM so Excel reads UTF-8, CRLF row ends. */
export function csvFile(rows: (string | number)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
