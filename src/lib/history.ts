import { formatMs, whenLabel } from "./earlierSends";
import type { HistoryEntry, SendOutcome } from "./types";

/** Response bodies kept with each history entry, so an earlier send can be shown again. */
export const MAX_HISTORY_BODY = 32 * 1024;

/**
 * An earlier send from history, shown again as a read-only sample. Entries saved before
 * responses were kept (or whose response was dropped to fit storage) still show their
 * status code, with an empty body.
 */
export function historyOutcome(h: HistoryEntry): SendOutcome {
  const request = { method: h.method, url: h.url, headers: [] as [string, string][] };
  if (h.response) return { ok: true, request, response: h.response, sentAt: h.sentAt };
  if (h.status === null) return { ok: false, request, error: h.error ?? "No response came back.", durationMs: h.durationMs ?? 0, sentAt: h.sentAt };
  return {
    ok: true,
    request,
    response: { status: h.status, statusText: "", headers: [], body: "", sizeBytes: 0, durationMs: h.durationMs ?? 0 },
    sentAt: h.sentAt,
  };
}

/** True when the entry has a status but its response body and headers were not kept. */
export function responseNotKept(h: HistoryEntry): boolean {
  return !h.response && h.status !== null;
}

/** Chip text for a shown send: "Sent 13:41 · 142 ms", plus why parts are missing. */
export function historyLabel(h: HistoryEntry, now: Date = new Date()): string {
  const when = whenLabel(h.sentAt, now);
  const time = h.durationMs !== undefined ? ` · ${formatMs(h.durationMs)}` : "";
  const extra = responseNotKept(h) ? " · response not kept" : h.response && h.response.sizeBytes > MAX_HISTORY_BODY ? " · body cut to 32 KB" : "";
  return `Sent ${when || "earlier"}${time}${extra}`;
}

/**
 * History that fits in storage: when `fits` refuses the full list, responses are dropped
 * from the oldest entries first, so the latest sends can still be shown after a restart.
 */
export function fitHistory(history: HistoryEntry[], fits: (h: HistoryEntry[]) => boolean): HistoryEntry[] | null {
  if (fits(history)) return history;
  let list = history;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!list[i].response) continue;
    const { response: _r, ...rest } = list[i];
    list = list.map((h, j) => (j === i ? rest : h));
    if (fits(list)) return list;
  }
  return null;
}
