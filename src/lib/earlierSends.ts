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

/**
 * "now" under 10 seconds, "12s ago" / "4m ago" under an hour, "13:41" earlier today,
 * "Yesterday", then a short date ("Oct 20"). Sends a few minutes apart read differently.
 */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const age = now.getTime() - d.getTime();
  if (age >= 0 && age < 10_000) return "now";
  if (age >= 0 && age < 60_000) return `${Math.floor(age / 1000)}s ago`;
  if (age >= 0 && age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const sameRows = (a: RequestDef["params"], b: RequestDef["params"]) =>
  JSON.stringify(a.filter((r) => r.key || r.value).map((r) => [r.key, r.value, r.enabled])) === JSON.stringify(b.filter((r) => r.key || r.value).map((r) => [r.key, r.value, r.enabled]));

/** What changed between two versions of a request, in a few words: "body changed", "params changed", "URL changed". Null when nothing did. */
export function diffSummary(prev: RequestDef, def: RequestDef): string | null {
  const changed: string[] = [];
  if (prev.method !== def.method) changed.push("method");
  if (prev.url !== def.url) changed.push("URL");
  if (!sameRows(prev.params, def.params)) changed.push("params");
  if (!sameRows(prev.headers, def.headers)) changed.push("headers");
  if (prev.bodyMode !== def.bodyMode || prev.body !== def.body || !sameRows(prev.formBody, def.formBody)) changed.push("body");
  if (JSON.stringify(prev.auth) !== JSON.stringify(def.auth)) changed.push("auth");
  return changed.length ? `${changed.join(", ")} changed` : null;
}

/** The send before this one for the same request, from the history (newest first). */
export function previousSend(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry | undefined {
  const i = history.findIndex((h) => h.id === entry.id);
  return history.slice(i + 1).find((h) => h.def?.id === entry.def?.id);
}

/** Tooltip for a pill: the full time, the environment, and what changed since the previous send. */
export function sendTooltip(entry: HistoryEntry, history: HistoryEntry[]): string {
  const prev = previousSend(history, entry);
  const lines = [`${entry.method} ${entry.url}`, new Date(entry.sentAt).toLocaleString()];
  if (entry.environmentName !== undefined) lines.push(`Environment: ${entry.environmentName || "none"}`);
  if (prev && entry.def && prev.def) lines.push(`Since the previous send: ${diffSummary(prev.def, entry.def) ?? "nothing changed"}`);
  return lines.join("\n");
}

/** Pill text: "201 · 142 ms · 4m ago" (plus "· Dev" for another environment), "ERR · 2.0 s · 13:30" or "Batch · 48/50 · 11:52". */
export function earlierSendLabel(item: EarlierSend, now: Date = new Date(), currentEnvName?: string): string {
  if (item.kind === "batch") return `Batch · ${item.run.passed}/${item.run.totalRows} · ${whenLabel(item.at, now)}`;
  const h = item.entry;
  const status = h.status ?? "ERR";
  const time = h.durationMs !== undefined ? ` · ${formatMs(h.durationMs)}` : "";
  // Only name the environment when it isn't the one selected now.
  const env = h.environmentName !== undefined && h.environmentName !== (currentEnvName ?? "") ? ` · ${h.environmentName || "no environment"}` : "";
  return `${status}${time} · ${whenLabel(item.at, now)}${env}`;
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
