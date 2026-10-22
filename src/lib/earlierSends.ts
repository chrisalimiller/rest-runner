import type { RunSummary } from "./run";
import type { HistoryEntry, RequestDef } from "./types";

/** One pill in the "Earlier sends of this request" strip. */
export type EarlierSend = { kind: "send"; at: string; entry: HistoryEntry } | { kind: "batch"; at: string; run: RunSummary };

export const MAX_EARLIER_SENDS = 6;

/** True when a saved batch run was made from this request. Older runs have no request id, so they match on name, method and URL. */
export function runIsForRequest(run: RunSummary, def: Pick<RequestDef, "id" | "name" | "method" | "url">): boolean {
  if (run.requestId) return run.requestId === def.id;
  return run.requestName === def.name && run.method === def.method && run.urlTemplate === def.url;
}

/** History entries and batch runs of the open request, newest first, at most `limit`. */
export function earlierSends(
  history: HistoryEntry[],
  runs: RunSummary[],
  def: Pick<RequestDef, "id" | "name" | "method" | "url">,
  limit = MAX_EARLIER_SENDS,
): EarlierSend[] {
  const sends: EarlierSend[] = history.filter((h) => h.def?.id === def.id).map((entry) => ({ kind: "send", at: entry.sentAt, entry }));
  const batches: EarlierSend[] = runs.filter((r) => runIsForRequest(r, def)).map((run) => ({ kind: "batch", at: run.startedAt, run }));
  return [...sends, ...batches].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** "142 ms" under a second, "2.0 s" under a minute, then "1 m 5 s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "now" within a minute, "13:41" earlier today, otherwise the date. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const age = now.getTime() - d.getTime();
  if (age >= 0 && age < 60_000) return "now";
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
}

/** Pill text: "201 · 142 ms · now", "ERR · 2.0 s · 13:30" or "Batch · 48/50 · 11:52". */
export function earlierSendLabel(item: EarlierSend, now: Date = new Date()): string {
  if (item.kind === "batch") return `Batch · ${item.run.passed}/${item.run.totalRows} · ${whenLabel(item.at, now)}`;
  const h = item.entry;
  const status = h.status ?? "ERR";
  const time = h.durationMs !== undefined ? ` · ${formatMs(h.durationMs)}` : "";
  return `${status}${time} · ${whenLabel(item.at, now)}`;
}

/** Color class for a pill: ok (2xx), redirect (3xx), warn (4xx), bad (5xx and errors), muted (batch). */
export function earlierSendTone(item: EarlierSend): "ok" | "redirect" | "warn" | "bad" | "muted" {
  if (item.kind === "batch") return "muted";
  return statusTone(item.entry.status);
}

export function statusTone(status: number | null): "ok" | "redirect" | "warn" | "bad" {
  if (status === null) return "bad";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "warn";
  return "bad";
}
