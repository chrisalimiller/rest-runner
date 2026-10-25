import type { Collection, TreeNode } from "./collections";
import type { RunSummary } from "./run";
import type { TestRunSummary } from "./testing/testRun";
import type { TestSuite } from "./testing/types";
import type { HistoryEntry } from "./types";
import type { Flow, FlowRunSummary } from "./flows/types";

/** Quick open (Ctrl/Cmd + K): one search over everything you can jump to. */

export type QuickKind = "request" | "example" | "history" | "batch-run" | "suite" | "case" | "test-run" | "flow" | "flow-run";

export interface QuickItem {
  kind: QuickKind;
  /** The id to open: request, example, history entry, run, suite or case id. */
  id: string;
  /** For a case, the suite it belongs to. */
  parentId?: string;
  title: string;
  /** Shown muted after the title: folder path, URL, time and so on. */
  detail: string;
  method?: string;
  /** Sort key for "most recent first" when there is no query (ISO time), if the item has one. */
  at?: string;
}

export const KIND_LABELS: Record<QuickKind, string> = {
  request: "Requests",
  example: "Examples",
  history: "History",
  "batch-run": "Batch runs",
  suite: "Suites",
  case: "Test cases",
  "test-run": "Test runs",
  flow: "Flows",
  "flow-run": "Flow runs",
};

/** Group order, per mode: the mode you are in comes first. */
export const KIND_ORDER: Record<"requests" | "testing" | "flows", QuickKind[]> = {
  requests: ["request", "example", "history", "batch-run", "suite", "case", "test-run", "flow", "flow-run"],
  testing: ["suite", "case", "test-run", "flow", "flow-run", "request", "example", "history", "batch-run"],
  flows: ["flow", "flow-run", "suite", "case", "test-run", "request", "example", "history", "batch-run"],
};

function walk(items: TreeNode[], path: string[], out: QuickItem[]) {
  for (const item of items) {
    if (item.kind === "folder") {
      walk(item.items, [...path, item.name], out);
      continue;
    }
    const r = item.request;
    out.push({ kind: "request", id: item.id, title: r.name, detail: path.join(" › "), method: r.method });
    for (const ex of item.examples) {
      out.push({ kind: "example", id: ex.id, title: ex.name, detail: [...path, r.name].join(" › "), method: ex.request.method });
    }
  }
}

export function collectionItems(collections: Collection[]): QuickItem[] {
  const out: QuickItem[] = [];
  for (const c of collections) walk(c.items, [c.name], out);
  return out;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function historyItems(history: HistoryEntry[]): QuickItem[] {
  return history.map((h) => ({
    kind: "history",
    id: h.id,
    title: shortUrl(h.url) || "(no URL)",
    detail: `${h.status ?? "ERR"} · ${h.def?.name ?? ""}`,
    method: h.method,
    at: h.sentAt,
  }));
}

export function batchRunItems(runs: RunSummary[]): QuickItem[] {
  return runs.map((r) => ({
    kind: "batch-run",
    id: r.id,
    title: r.requestName,
    detail: `${r.csvName} · ${r.passed}/${r.totalRows} passed`,
    method: r.method,
    at: r.startedAt,
  }));
}

export function suiteItems(suites: TestSuite[]): QuickItem[] {
  const out: QuickItem[] = [];
  for (const s of suites) {
    out.push({ kind: "suite", id: s.id, title: s.name || "(unnamed)", detail: `${s.cases.length} case${s.cases.length === 1 ? "" : "s"}` });
    for (const c of s.cases) out.push({ kind: "case", id: c.id, parentId: s.id, title: c.name, detail: s.name, method: c.request.method });
  }
  return out;
}

export function testRunItems(runs: TestRunSummary[]): QuickItem[] {
  return runs.map((r) => ({
    kind: "test-run",
    id: r.id,
    title: r.suiteName,
    detail: `${r.passed} passed${r.failed ? `, ${r.failed} failed` : ""}${r.csvName ? ` · ${r.csvName}` : ""}`,
    at: r.startedAt,
  }));
}

export function flowItems(flows: Flow[]): QuickItem[] {
  return flows.map((f) => {
    const steps = f.nodes.filter((n) => n.type !== "note" && n.type !== "start" && n.type !== "schedule").length;
    return { kind: "flow", id: f.id, title: f.name || "(unnamed)", detail: f.description || `${steps} step${steps === 1 ? "" : "s"}` };
  });
}

const FLOW_END: Record<FlowRunSummary["end"], string> = { passed: "passed", failed: "failed", cancelled: "stopped" };

export function flowRunItems(runs: FlowRunSummary[]): QuickItem[] {
  return runs.map((r) => ({
    kind: "flow-run",
    id: r.id,
    title: r.flowName,
    detail: `${FLOW_END[r.end]} · ${r.passedSteps} passed${r.failedSteps ? `, ${r.failedSteps} failed` : ""}${r.trigger !== "manual" ? " · scheduled" : ""}`,
    at: r.startedAt,
  }));
}

const isWordStart = (text: string, i: number) => i === 0 || /[\s/›._\-:?&=]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]));

/**
 * Fuzzy match: every character of the query must appear in order. Higher is better;
 * null means no match. Runs of consecutive characters, matches at word starts, and
 * a match inside the title score higher.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (q === "") return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += 1;
    if (found === prev + 1) score += 3;
    if (isWordStart(text, found)) score += 2;
    prev = found;
    ti = found + 1;
  }
  if (direct !== -1) score += 10 + (direct === 0 ? 5 : 0);
  return score - text.length * 0.01;
}

export interface QuickGroup {
  kind: QuickKind;
  label: string;
  items: QuickItem[];
}

/** Scores an item: the title counts fully, the detail and method a bit less. */
function itemScore(query: string, item: QuickItem): number | null {
  const title = fuzzyScore(query, item.title);
  const full = fuzzyScore(query, `${item.method ?? ""} ${item.title} ${item.detail}`);
  if (title === null && full === null) return null;
  return Math.max(title !== null ? title + 5 : -Infinity, full ?? -Infinity);
}

/** Matching items grouped by type in `order`, best first, at most `perGroup` each. With no query, recent items first. */
export function searchQuickOpen(items: QuickItem[], query: string, order: QuickKind[], perGroup = 6): QuickGroup[] {
  const q = query.trim();
  const groups: QuickGroup[] = [];
  for (const kind of order) {
    const ofKind = items.filter((i) => i.kind === kind);
    let picked: QuickItem[];
    if (q === "") {
      picked = [...ofKind].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, perGroup);
    } else {
      picked = ofKind
        .map((item) => ({ item, score: itemScore(q, item) }))
        .filter((x): x is { item: QuickItem; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, perGroup)
        .map((x) => x.item);
    }
    if (picked.length) groups.push({ kind, label: KIND_LABELS[kind], items: picked });
  }
  return groups;
}
