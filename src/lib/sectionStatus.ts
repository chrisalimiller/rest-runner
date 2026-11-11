import { useSyncExternalStore } from "react";

/**
 * What the side rail shows beside its buttons: whether Testing or Flows is running, whether the latest run failed
 * and the user has not looked yet, and facts about the active request (unfilled variables, certificate in use).
 * Module state with subscribers, like busyWork.ts and certificatesDialog.ts.
 */
export type StatusSection = "testing" | "flows" | "tools";

export interface SectionState {
  running: boolean;
  /** Failed cases (Testing) or failed steps (Flows) in the latest finished run. */
  failed: number;
  /** The latest run finished and the user has not opened the section since. */
  unseen: boolean;
}

export interface RequestStatus {
  /** Placeholders in the active request that no variable fills. */
  unfilled: number;
  /** Name of the client certificate the active request is sent with, if any. */
  certInUse: string | null;
  /** The active request's final URL, for the Certificates panel. */
  url: string;
  /** The active request leaves the client certificate out. */
  skipped: boolean;
  /** Sets that for the active request. Null when no Requests view is ready. */
  onSkip: ((skip: boolean) => void) | null;
}

export interface SectionStatus {
  testing: SectionState;
  flows: SectionState;
  tools: SectionState;
  request: RequestStatus | null;
}

const EMPTY: SectionState = { running: false, failed: 0, unseen: false };

let state: SectionStatus = { testing: EMPTY, flows: EMPTY, tools: EMPTY, request: null };
const listeners = new Set<() => void>();

function set(next: SectionStatus) {
  state = next;
  listeners.forEach((l) => l());
}

export function setSectionStatus(section: StatusSection, patch: Partial<SectionState>): void {
  const cur = state[section];
  const next = { ...cur, ...patch };
  if (next.running === cur.running && next.failed === cur.failed && next.unseen === cur.unseen) return;
  set({ ...state, [section]: next });
}

/** The user opened a section: its "latest run failed" badge goes away. */
export function markSectionSeen(section: StatusSection): void {
  setSectionStatus(section, { unseen: false });
}

export function setRequestStatus(request: RequestStatus | null): void {
  const cur = state.request;
  if (cur && request && cur.unfilled === request.unfilled && cur.certInUse === request.certInUse && cur.url === request.url && cur.skipped === request.skipped && cur.onSkip === request.onSkip) return;
  set({ ...state, request });
}

export function getSectionStatus(): SectionStatus {
  return state;
}

export function resetSectionStatus(): void {
  set({ testing: EMPTY, flows: EMPTY, tools: EMPTY, request: null });
}

export function useSectionStatus(): SectionStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export type RailItem = "requests" | "testing" | "flows" | "tools" | "variables" | "certificates";
export type BadgeTone = "bad" | "accent" | "ok" | "warn";

export interface RailBadge {
  /** A pill with text, or a small dot with none. */
  kind: "pill" | "dot";
  text: string;
  tone: BadgeTone;
}

/** A stored certificate counts as expiring this many days ahead. */
export const CERT_WARNING_DAYS = 30;

/** Whether any certificate (Unix seconds `notAfter`) is expired or runs out within 30 days. Exactly 30 days is not yet. */
export function certExpiresSoon(notAfter: readonly number[], now: number): boolean {
  return notAfter.some((n) => n * 1000 - now < CERT_WARNING_DAYS * 86_400_000);
}

/** The badge for a rail button, or null. `certNotAfter` lists the expiry (Unix seconds) of every stored certificate. */
export function railBadge(item: RailItem, status: SectionStatus & { certNotAfter?: readonly number[] }, now: number): RailBadge | null {
  switch (item) {
    case "testing": {
      const s = status.testing;
      if (s.running) return { kind: "pill", text: "●", tone: "accent" };
      if (s.unseen && s.failed > 0) return { kind: "pill", text: `${s.failed > 99 ? "99+" : s.failed}✕`, tone: "bad" };
      return null;
    }
    case "flows": {
      const s = status.flows;
      if (s.running) return { kind: "pill", text: "●", tone: "ok" };
      if (s.unseen && s.failed > 0) return { kind: "pill", text: "✕", tone: "bad" };
      return null;
    }
    case "tools": {
      const s = status.tools;
      if (s.running) return { kind: "pill", text: "●", tone: "accent" };
      if (s.unseen && s.failed > 0) return { kind: "pill", text: "✕", tone: "bad" };
      return null;
    }
    case "variables": {
      const n = status.request?.unfilled ?? 0;
      return n > 0 ? { kind: "pill", text: n > 99 ? "99+" : String(n), tone: "warn" } : null;
    }
    case "certificates": {
      if (certExpiresSoon(status.certNotAfter ?? [], now)) return { kind: "dot", text: "", tone: "warn" };
      if (status.request?.certInUse) return { kind: "dot", text: "", tone: "ok" };
      return null;
    }
    default:
      return null;
  }
}
