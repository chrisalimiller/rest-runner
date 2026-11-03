import { certificateLabel } from "./certificates";
import { durationOf } from "./run";
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

/** The call's cells, matching CALL_COLUMNS. With no outcome the case never ran, so the status says so and the rest is empty. */
export function callCells(o: SendOutcome | null | undefined): (string | number)[] {
  if (!o) return ["Not sent", ...CALL_COLUMNS.slice(1).map(() => "")];
  const res = o.ok ? o.response : null;
  return [
    res ? String(res.status) : "Error",
    res?.statusText ?? "",
    durationOf(o),
    o.sentAt,
    o.request.method,
    o.request.url,
    headerLines(o.request.headers),
    o.request.body ?? "",
    res ? headerLines(res.headers) : "",
    res?.body ?? "",
    res?.sizeBytes ?? "",
    o.ok ? "" : o.error,
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
