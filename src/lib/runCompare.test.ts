import { describe, expect, it } from "vitest";
import { DEFAULT_BATCH_OPTIONS } from "./batch";
import { newRequest } from "./defaults";
import { buildRun, MAX_SAVED_BODY, summaryOf, type Run } from "./run";
import { classifyRow, compareChoices, compareRuns, diffJson, filterChanges, isFaster, isSlower, isTruncated, percentile, statusClassLabel } from "./runCompare";
import type { SendOutcome } from "./types";

const REQ = { method: "GET" as const, url: "https://a.test/1", headers: [] as [string, string][], body: "" };
const ok = (status: number, ms: number, body = "{}"): SendOutcome => ({
  ok: true,
  request: REQ,
  sentAt: "2026-10-22T10:00:00.000Z",
  response: { status, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: ms },
});
const err = (ms = 5): SendOutcome => ({ ok: false, request: REQ, error: "boom", durationMs: ms, sentAt: "2026-10-22T10:00:00.000Z" });

function mk(id: string, specs: SendOutcome[], extra: Partial<Parameters<typeof buildRun>[0]> = {}): Run {
  return buildRun({
    id,
    request: { ...newRequest(), id: "req1", name: "R", url: "https://a.test/{{id}}" },
    csvName: "d.csv",
    columns: ["id"],
    totalRows: specs.length,
    options: DEFAULT_BATCH_OPTIONS,
    startedAt: "2026-10-22T10:00:00.000Z",
    finishedAt: "2026-10-22T10:00:10.000Z",
    end: "completed",
    results: specs.map((outcome, index) => ({ index, vars: { id: String(index) }, outcome, failed: !outcome.ok || outcome.response.status >= 400 })),
    missingPlaceholders: [],
    ...extra,
  });
}

describe("percentile", () => {
  it("handles empty, single and unsorted input", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([30, 10, 20, 40], 50)).toBe(20);
    expect(percentile(Array.from({ length: 100 }, (_, i) => 100 - i), 95)).toBe(95);
  });
});

describe("statusClassLabel", () => {
  it("groups by class", () => {
    expect(statusClassLabel("200")).toBe("2xx");
    expect(statusClassLabel("503")).toBe("5xx");
    expect(statusClassLabel("Error")).toBe("Error");
  });
});

describe("slower / faster thresholds", () => {
  it("needs both +50% and +100ms", () => {
    expect(isSlower(100, 200)).toBe(true);
    expect(isSlower(100, 199)).toBe(false);
    expect(isSlower(1000, 1400)).toBe(false);
    expect(isSlower(1000, 1500)).toBe(true);
    expect(isSlower(10, 90)).toBe(false);
    expect(isFaster(200, 100)).toBe(true);
    expect(isFaster(100, 200)).toBe(false);
  });
});

describe("classifyRow", () => {
  const entry = (o: SendOutcome) => mk("x", [o]).entries[0];
  it("returns null when nothing meaningful changed", () => {
    expect(classifyRow(0, entry(ok(200, 50)), entry(ok(201, 60)))).toBeNull();
  });
  it("flags pass to fail as a regression", () => {
    const c = classifyRow(0, entry(ok(200, 50)), entry(ok(500, 50)))!;
    expect(c.regression).toBe(true);
    expect(c.kind).toBe("regression");
    expect(c.statusChanged).toBe(true);
  });
  it("flags fail to pass as a fix", () => {
    expect(classifyRow(0, entry(ok(500, 50)), entry(ok(200, 50)))!.fix).toBe(true);
  });
  it("treats a connection error as a regression from 200", () => {
    expect(classifyRow(0, entry(ok(200, 5)), entry(err()))!.regression).toBe(true);
  });
  it("worse failing class counts as regression, better as fix", () => {
    expect(classifyRow(0, entry(ok(404, 5)), entry(ok(500, 5)))!.regression).toBe(true);
    expect(classifyRow(0, entry(ok(500, 5)), entry(ok(404, 5)))!.fix).toBe(true);
  });
  it("a new redirect is a status change", () => {
    const c = classifyRow(0, entry(ok(200, 5)), entry(ok(301, 5)))!;
    expect(c.statusChanged).toBe(true);
  });
  it("flags slower with unchanged status", () => {
    const c = classifyRow(0, entry(ok(200, 100)), entry(ok(200, 400)))!;
    expect(c.slower).toBe(true);
    expect(c.kind).toBe("slower");
    expect(c.statusChanged).toBe(false);
  });
  it("flags faster", () => {
    expect(classifyRow(0, entry(ok(200, 400)), entry(ok(200, 100)))!.kind).toBe("faster");
  });
  it("one-sided rows", () => {
    expect(classifyRow(3, entry(ok(200, 1)), null)!.onlyIn).toBe("base");
    expect(classifyRow(3, null, entry(ok(200, 1)))!.kind).toBe("new");
    expect(classifyRow(3, null, null)).toBeNull();
  });
});

describe("compareRuns", () => {
  it("summarises deltas and lists only changed rows", () => {
    const base = mk("a", [ok(200, 100), ok(200, 100), ok(500, 100), ok(200, 100)]);
    const cur = mk("b", [ok(200, 110), ok(503, 100), ok(200, 100), ok(200, 400)]);
    const r = compareRuns(base, cur);
    expect(r.compared).toBe(4);
    expect(r.changes.map((c) => [c.index, c.kind])).toEqual([[1, "regression"], [2, "fix"], [3, "slower"]]);
    expect(r.unchanged).toBe(1);
    expect(r.summary.passed).toEqual({ base: 3, current: 3, delta: 0 });
    expect(r.summary.avgMs).toEqual({ base: 100, current: 178, delta: 78 });
    expect(r.summary.p95Ms).toEqual({ base: 100, current: 400, delta: 300 });
    expect(r.counts).toMatchObject({ regressions: 1, fixes: 1, slower: 1 });
    expect(r.warnings).toEqual([]);
  });

  it("reports no differences for identical runs", () => {
    const r = compareRuns(mk("a", [ok(200, 10), ok(200, 20)]), mk("b", [ok(200, 10), ok(200, 20)]));
    expect(r.changes).toEqual([]);
    expect(r.unchanged).toBe(2);
  });

  it("handles differing row counts and warns", () => {
    const r = compareRuns(mk("a", [ok(200, 10), ok(200, 10)]), mk("b", [ok(200, 10), ok(200, 10), ok(200, 10)]));
    expect(r.compared).toBe(2);
    expect(r.counts.onlyCurrent).toBe(1);
    expect(r.changes[0]).toMatchObject({ index: 2, kind: "new" });
    expect(r.unchanged).toBe(2);
    expect(r.warnings[0]).toMatch(/different row counts/);
  });

  it("handles empty runs", () => {
    const r = compareRuns(mk("a", []), mk("b", []));
    expect(r.changes).toEqual([]);
    expect(r.summary.avgMs.delta).toBe(0);
    expect(r.compared).toBe(0);
  });

  it("warns about different CSVs, urls, unfinished runs and truncated responses", () => {
    const big = "x".repeat(MAX_SAVED_BODY + 10);
    const base = mk("a", [ok(200, 10)], { csvName: "one.csv" });
    const cur = mk("b", [ok(200, 10, big)], { csvName: "two.csv", end: "cancelled", request: { ...newRequest(), id: "req1", name: "R", url: "https://other/{{id}}" } });
    const w = compareRuns(base, cur).warnings.join("\n");
    expect(w).toMatch(/different CSV files/);
    expect(w).toMatch(/different request URLs/);
    expect(w).toMatch(/did not finish/);
    expect(w).toMatch(/cut short/);
  });

  it("matches by row index even when entries are missing in the middle", () => {
    const base = mk("a", [ok(200, 10), ok(200, 10), ok(200, 10)]);
    base.entries = base.entries.filter((e) => e.index !== 1);
    const cur = mk("b", [ok(200, 10), ok(500, 10), ok(500, 10)]);
    const r = compareRuns(base, cur);
    expect(r.changes.map((c) => [c.index, c.kind])).toEqual([[1, "new"], [2, "regression"]]);
  });
});

describe("filterChanges", () => {
  const base = mk("a", [ok(200, 100), ok(500, 100), ok(200, 100), ok(200, 100)]);
  const cur = mk("b", [ok(500, 100), ok(200, 100), ok(200, 500), ok(200, 100)]);
  const { changes } = compareRuns(base, cur);
  it("filters", () => {
    expect(filterChanges(changes, "all")).toHaveLength(3);
    expect(filterChanges(changes, "regressions").map((c) => c.index)).toEqual([0]);
    expect(filterChanges(changes, "fixes").map((c) => c.index)).toEqual([1]);
    expect(filterChanges(changes, "slower").map((c) => c.index)).toEqual([2]);
  });
  it("a row that is both a regression and slower shows in both filters", () => {
    const c = compareRuns(mk("a", [ok(200, 100)]), mk("b", [ok(500, 900)])).changes;
    expect(filterChanges(c, "regressions")).toHaveLength(1);
    expect(filterChanges(c, "slower")).toHaveLength(1);
  });
});

describe("isTruncated", () => {
  it("is true only for responses cut by the save limit", () => {
    const big = "x".repeat(MAX_SAVED_BODY + 10);
    expect(isTruncated(mk("a", [ok(200, 1, big)]).entries[0])).toBe(true);
    expect(isTruncated(mk("a", [ok(200, 1)]).entries[0])).toBe(false);
    expect(isTruncated(mk("a", [err()]).entries[0])).toBe(false);
  });
});

describe("compareChoices", () => {
  const s = (id: string, over: Partial<ReturnType<typeof summaryOf>> = {}) => ({ ...summaryOf(mk(id, [ok(200, 1)])), ...over });
  it("excludes self, puts same request first, then same CSV, drops the rest", () => {
    const base = s("base", { startedAt: "2026-10-22T10:00:00Z" });
    const all = [
      base,
      s("other-req-same-csv", { requestId: "zzz", startedAt: "2026-10-23T00:00:00Z" }),
      s("same-old", { startedAt: "2026-10-20T00:00:00Z" }),
      s("same-new", { startedAt: "2026-10-21T00:00:00Z" }),
      s("unrelated", { requestId: "q", csvName: "x.csv" }),
    ];
    expect(compareChoices(base, all).map((c) => c.run.id)).toEqual(["same-new", "same-old", "other-req-same-csv"]);
  });
  it("falls back to method, url and name for runs saved without a request id", () => {
    const base = s("base", { requestId: undefined, csvName: "a.csv" });
    const all = [s("same", { requestId: undefined, csvName: "b.csv" }), s("diff", { requestId: undefined, csvName: "b.csv", urlTemplate: "https://z" })];
    expect(compareChoices(base, all).map((c) => c.run.id)).toEqual(["same"]);
  });
  it("is empty when nothing else is saved", () => {
    const base = s("base");
    expect(compareChoices(base, [base])).toEqual([]);
  });
});

describe("diffJson", () => {
  it("finds changed, added and removed fields at nested paths", () => {
    const d = diffJson('{"a":1,"b":{"c":[1,2]},"gone":true}', '{"a":2,"b":{"c":[1,3]},"new":"x"}');
    expect(d.ok && d.changes).toEqual([
      { path: "a", kind: "changed", before: "1", after: "2" },
      { path: "b.c[1]", kind: "changed", before: "2", after: "3" },
      { path: "gone", kind: "removed", before: "true" },
      { path: "new", kind: "added", after: '"x"' },
    ]);
  });
  it("reports no changes for equal JSON with different formatting", () => {
    expect(diffJson('{"a": 1}', '{ "a":1 }')).toEqual({ ok: true, changes: [], capped: false });
  });
  it("handles root type changes and invalid JSON", () => {
    const d = diffJson("[1]", '{"a":1}');
    expect(d.ok && d.changes[0].path).toBe("(root)");
    expect(diffJson("nope", "{}").ok).toBe(false);
  });
  it("caps the number of changes", () => {
    const a = JSON.stringify(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 1])));
    const b = JSON.stringify(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 2])));
    const d = diffJson(a, b, 3);
    expect(d.ok && d.changes.length).toBe(3);
    expect(d.ok && d.capped).toBe(true);
  });
});
