import type { Run } from "./run";
import { isPlainObject, load, save } from "./storage";
import type { Vars } from "./template";

/** What the most recent saved run did with a CSV row. A row with no entry has not been run. */
export type RowStatus = "passed" | "failed";
export type LastRunFilter = "" | RowStatus | "none";

export interface RowFilters {
  /** Per column: what to match. Empty means no filter on that column. */
  columns: Record<string, string>;
  last: LastRunFilter;
}

export const NO_FILTERS: RowFilters = { columns: {}, last: "" };

export function hasFilters(f: RowFilters): boolean {
  return f.last !== "" || Object.values(f.columns).some((v) => v !== "");
}

/**
 * 0-based indices of the rows that pass the filters. Columns in `exact` (the ones filtered from a dropdown)
 * must match whole; the others match when they contain the text, ignoring case.
 */
export function filterRows(
  rows: Vars[],
  filters: RowFilters,
  exact: ReadonlySet<string>,
  statuses: ReadonlyMap<number, RowStatus>,
): number[] {
  const active = Object.entries(filters.columns).filter(([, v]) => v !== "");
  const out: number[] = [];
  rows.forEach((row, i) => {
    for (const [col, want] of active) {
      const have = String(row[col] ?? "");
      if (exact.has(col) ? have !== want : !have.toLowerCase().includes(want.toLowerCase())) return;
    }
    if (filters.last !== "") {
      const s = statuses.get(i) ?? "none";
      if (s !== filters.last) return;
    }
    out.push(i);
  });
  return out;
}

/** Columns with a handful of distinct values get a dropdown instead of a text box. */
export function dropdownOptions(rows: Vars[], column: string, max = 8): string[] | null {
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(String(r[column] ?? ""));
    if (seen.size > max) return null;
  }
  return seen.size >= 2 ? [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : null;
}

/** Turns "from" and "to" row numbers (1-based, as typed) into 0-based indices, swapped if backwards and clamped to the file. */
export function rangeIndices(from: string, to: string, count: number): number[] {
  let a = Math.round(Number(from));
  let b = Math.round(Number(to));
  if (!Number.isFinite(a) || !Number.isFinite(b) || from.trim() === "" || to.trim() === "" || count === 0) return [];
  if (a > b) [a, b] = [b, a];
  a = Math.max(1, a);
  b = Math.min(count, b);
  const out: number[] = [];
  for (let n = a; n <= b; n++) out.push(n - 1);
  return out;
}

/** The latest status of each row across runs of the same CSV, given oldest run first. */
export function rowStatuses(runs: Run[]): Map<number, RowStatus> {
  const map = new Map<number, RowStatus>();
  for (const run of runs) {
    for (const e of run.entries) map.set(e.index, e.failed ? "failed" : "passed");
  }
  return map;
}

/** Picks the saved runs that belong to this CSV and request, oldest first. */
export function matchingRuns<T extends { csvName: string; requestId?: string; urlTemplate: string; startedAt: string }>(
  runs: T[],
  csvName: string,
  requestId: string,
  url: string,
): T[] {
  return runs
    .filter((r) => r.csvName === csvName && (r.requestId ? r.requestId === requestId : r.urlTemplate === url))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

// ---- Remembering which rows were selected, per CSV file ----

const SELECTION_KEY = "rest-runner.batch-selection";
const MAX_REMEMBERED = 50;

interface Remembered {
  rows: number;
  /** Inclusive [start, end] runs of 0-based row indices. */
  ranges: [number, number][];
}

export function toRanges(indices: Iterable<number>): [number, number][] {
  const sorted = [...indices].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else if (!last || i > last[1]) out.push([i, i]);
  }
  return out;
}

export function fromRanges(ranges: [number, number][], count: number): Set<number> {
  const out = new Set<number>();
  for (const [a, b] of ranges) for (let i = Math.max(0, a); i <= Math.min(count - 1, b); i++) out.add(i);
  return out;
}

const validRanges = (x: unknown): x is [number, number][] =>
  Array.isArray(x) && x.every((r) => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]));

/** The rows chosen last time for a file of this name and size, or every row when there is nothing usable. */
export function loadSelection(csvName: string, count: number): Set<number> {
  const all = load<Record<string, unknown>>(SELECTION_KEY, {}, isPlainObject);
  const hit = all[csvName];
  if (isPlainObject(hit) && hit.rows === count && validRanges(hit.ranges)) return fromRanges(hit.ranges, count);
  return new Set(Array.from({ length: count }, (_, i) => i));
}

export function saveSelection(csvName: string, count: number, selected: ReadonlySet<number>): void {
  const all = load<Record<string, unknown>>(SELECTION_KEY, {}, isPlainObject);
  delete all[csvName]; // re-insert last so the oldest entries are the ones dropped
  const entry: Remembered = { rows: count, ranges: toRanges(selected) };
  const next = { ...all, [csvName]: entry };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete next[k];
  save(SELECTION_KEY, next);
}
