import { durationOf, runStats, statusLabel, type Run, type RunEntry, type RunSummary } from "./run";

/** A call counts as slower when it takes at least this much longer than before AND at least SLOWER_MIN_MS more. */
export const SLOWER_RATIO = 1.5;
export const SLOWER_MIN_MS = 100;

export type ChangeKind = "regression" | "fix" | "slower" | "faster" | "status" | "new" | "missing";
export type CompareFilter = "all" | "regressions" | "fixes" | "slower";

export interface RowChange {
  /** 0-based CSV row. */
  index: number;
  base: RunEntry | null;
  current: RunEntry | null;
  baseStatus: string;
  currentStatus: string;
  baseMs: number | null;
  currentMs: number | null;
  /** Pass to fail, or a worse status class when pass/fail is unchanged. */
  regression: boolean;
  /** Fail to pass, or a better status class when pass/fail is unchanged. */
  fix: boolean;
  slower: boolean;
  faster: boolean;
  /** The status class (2xx, 4xx, Error...) is different. */
  statusChanged: boolean;
  /** Present on one side only. */
  onlyIn: "base" | "current" | null;
  kind: ChangeKind;
}

export interface Delta {
  base: number;
  current: number;
  delta: number;
}

export interface CompareSummary {
  baseCompleted: number;
  currentCompleted: number;
  passed: Delta;
  failed: Delta;
  avgMs: Delta;
  p50Ms: Delta;
  p95Ms: Delta;
}

export interface Comparison {
  summary: CompareSummary;
  /** Rows that differ, in row order. */
  changes: RowChange[];
  /** Rows present in both runs. */
  compared: number;
  /** Rows present in both runs with no meaningful difference. */
  unchanged: number;
  counts: { regressions: number; fixes: number; slower: number; onlyBase: number; onlyCurrent: number };
  /** Plain-language reasons the match may be imperfect. Empty when the runs line up. */
  warnings: string[];
}

export function statusClassLabel(label: string): string {
  const n = Number(label);
  return Number.isFinite(n) && n > 0 ? `${Math.floor(n / 100)}xx` : label;
}

/** Higher is worse. */
function severity(label: string): number {
  const n = Number(label);
  if (!Number.isFinite(n)) return 5;
  if (n < 300) return 0;
  if (n < 400) return 1;
  if (n < 500) return 2;
  return 3;
}

export function isSlower(baseMs: number, currentMs: number): boolean {
  return currentMs >= baseMs * SLOWER_RATIO && currentMs - baseMs >= SLOWER_MIN_MS;
}

export function isFaster(baseMs: number, currentMs: number): boolean {
  return isSlower(currentMs, baseMs);
}

/** Nearest-rank percentile of an unsorted list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function delta(base: number, current: number): Delta {
  return { base, current, delta: current - base };
}

/** Classifies one row. Returns null when both sides exist and nothing meaningful changed. */
export function classifyRow(index: number, base: RunEntry | null, current: RunEntry | null): RowChange | null {
  if (!base && !current) return null;
  const baseStatus = base ? statusLabel(base.outcome) : "";
  const currentStatus = current ? statusLabel(current.outcome) : "";
  const baseMs = base ? durationOf(base.outcome) : null;
  const currentMs = current ? durationOf(current.outcome) : null;
  const out: RowChange = {
    index,
    base,
    current,
    baseStatus,
    currentStatus,
    baseMs,
    currentMs,
    regression: false,
    fix: false,
    slower: false,
    faster: false,
    statusChanged: false,
    onlyIn: !base ? "current" : !current ? "base" : null,
    kind: "status",
  };
  if (!base || !current) {
    out.kind = base ? "missing" : "new";
    return out;
  }
  out.statusChanged = statusClassLabel(baseStatus) !== statusClassLabel(currentStatus);
  if (!base.failed && current.failed) out.regression = true;
  else if (base.failed && !current.failed) out.fix = true;
  else if (out.statusChanged) {
    const diff = severity(currentStatus) - severity(baseStatus);
    if (diff > 0) out.regression = true;
    else if (diff < 0) out.fix = true;
  }
  out.slower = isSlower(baseMs!, currentMs!);
  out.faster = isFaster(baseMs!, currentMs!);
  if (!out.regression && !out.fix && !out.statusChanged && !out.slower && !out.faster) return null;
  out.kind = out.regression ? "regression" : out.fix ? "fix" : out.statusChanged ? "status" : out.slower ? "slower" : "faster";
  return out;
}

/** True when the saved response body was cut short when the run was saved. */
export function isTruncated(entry: RunEntry): boolean {
  const o = entry.outcome;
  return o.ok && o.response.body.length > 0 && o.response.sizeBytes > o.response.body.length && entry.notes.some((n) => n.includes("were saved"));
}

/** Compares two saved runs row by row (matching on CSV row index). `base` is the reference run. */
export function compareRuns(base: Run, current: Run): Comparison {
  const baseByIndex = new Map(base.entries.map((e) => [e.index, e]));
  const currentByIndex = new Map(current.entries.map((e) => [e.index, e]));
  const indexes = [...new Set([...baseByIndex.keys(), ...currentByIndex.keys()])].sort((a, b) => a - b);

  const changes: RowChange[] = [];
  let compared = 0;
  for (const i of indexes) {
    const b = baseByIndex.get(i) ?? null;
    const c = currentByIndex.get(i) ?? null;
    if (b && c) compared++;
    const change = classifyRow(i, b, c);
    if (change) changes.push(change);
  }

  const bs = runStats(base);
  const cs = runStats(current);
  const baseMs = base.entries.map((e) => durationOf(e.outcome));
  const currentMs = current.entries.map((e) => durationOf(e.outcome));
  const summary: CompareSummary = {
    baseCompleted: bs.completed,
    currentCompleted: cs.completed,
    passed: delta(bs.passed, cs.passed),
    failed: delta(bs.failed, cs.failed),
    avgMs: delta(bs.avgMs, cs.avgMs),
    p50Ms: delta(percentile(baseMs, 50), percentile(currentMs, 50)),
    p95Ms: delta(percentile(baseMs, 95), percentile(currentMs, 95)),
  };

  const warnings: string[] = [];
  if (base.totalRows !== current.totalRows || bs.completed !== cs.completed) {
    warnings.push(
      `The runs have different row counts (${bs.completed} of ${base.totalRows} sent, against ${cs.completed} of ${current.totalRows}). Rows are matched by row number; rows present in only one run are listed separately.`,
    );
  }
  if (base.csvName !== current.csvName) {
    warnings.push(`The runs used different CSV files (${base.csvName} and ${current.csvName}). Rows are matched by row number, so they may not be the same inputs.`);
  } else if (base.columns.join("\u0000") !== current.columns.join("\u0000")) {
    warnings.push("The CSV columns differ between the runs. Rows are matched by row number only.");
  }
  if (base.method !== current.method || base.urlTemplate !== current.urlTemplate) {
    warnings.push("The runs were made with different request URLs or methods, so differences may come from the request itself.");
  }
  if (base.end !== "completed" || current.end !== "completed") {
    warnings.push("At least one run did not finish, so some rows are missing.");
  }
  const trunc = [...base.entries, ...current.entries].filter(isTruncated).length;
  if (trunc) warnings.push(`${trunc} saved ${trunc === 1 ? "response was" : "responses were"} cut short, so body differences for those rows may be incomplete.`);

  return {
    summary,
    changes,
    compared,
    unchanged: compared - changes.filter((c) => !c.onlyIn).length,
    counts: {
      regressions: changes.filter((c) => c.regression).length,
      fixes: changes.filter((c) => c.fix).length,
      slower: changes.filter((c) => c.slower).length,
      onlyBase: changes.filter((c) => c.onlyIn === "base").length,
      onlyCurrent: changes.filter((c) => c.onlyIn === "current").length,
    },
    warnings,
  };
}

export function filterChanges(changes: RowChange[], filter: CompareFilter): RowChange[] {
  switch (filter) {
    case "regressions":
      return changes.filter((c) => c.regression);
    case "fixes":
      return changes.filter((c) => c.fix);
    case "slower":
      return changes.filter((c) => c.slower);
    default:
      return changes;
  }
}

export interface CompareChoice {
  run: RunSummary;
  /** Same request (by id, or by method, URL and name for runs saved before ids existed). */
  sameRequest: boolean;
  /** Same CSV file name, so rows probably line up. */
  sameCsv: boolean;
}

/** Other saved runs worth comparing with `base`: the same request first, then the same CSV file. Newest first within each. */
export function compareChoices(base: RunSummary, all: RunSummary[]): CompareChoice[] {
  const out: CompareChoice[] = [];
  for (const r of all) {
    if (r.id === base.id) continue;
    const sameRequest =
      base.requestId && r.requestId
        ? base.requestId === r.requestId
        : r.method === base.method && r.urlTemplate === base.urlTemplate && r.requestName === base.requestName;
    const sameCsv = r.csvName === base.csvName;
    if (sameRequest || sameCsv) out.push({ run: r, sameRequest, sameCsv });
  }
  return out.sort((a, b) => Number(b.sameRequest) - Number(a.sameRequest) || b.run.startedAt.localeCompare(a.run.startedAt));
}

export interface JsonChange {
  path: string;
  kind: "changed" | "added" | "removed";
  before?: string;
  after?: string;
}

function show(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? "undefined" : s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function walk(a: unknown, b: unknown, path: string, out: JsonChange[], cap: number): void {
  if (out.length >= cap) return;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const p = Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k;
      if (!(k in a)) out.push({ path: p, kind: "added", after: show(b[k]) });
      else if (!(k in b)) out.push({ path: p, kind: "removed", before: show(a[k]) });
      else walk(a[k], b[k], p, out, cap);
      if (out.length >= cap) return;
    }
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || "(root)", kind: "changed", before: show(a), after: show(b) });
}

export type JsonDiff = { ok: true; changes: JsonChange[]; capped: boolean } | { ok: false; reason: string };

/** Field-level difference of two JSON bodies. Returns a reason instead when either side is not JSON. */
export function diffJson(before: string, after: string, cap = 100): JsonDiff {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(before);
    b = JSON.parse(after);
  } catch {
    return { ok: false, reason: "One or both bodies are not valid JSON." };
  }
  const changes: JsonChange[] = [];
  walk(a, b, "", changes, cap + 1);
  const capped = changes.length > cap;
  return { ok: true, changes: capped ? changes.slice(0, cap) : changes, capped };
}
