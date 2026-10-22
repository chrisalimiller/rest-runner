import { describe, expect, it } from "vitest";
import { DEFAULT_BATCH_OPTIONS, type BatchItemResult } from "./batch";
import { newRequest } from "./defaults";
import { buildRun, entryNotes, MAX_SAVED_BODY, runStats } from "./run";
import type { SendOutcome } from "./types";

const req = { method: "POST" as const, url: "https://a.test/u/1", headers: [] as [string, string][], body: '{"a":1}' };

function ok(status: number, ms: number, body = "{}", contentType = "application/json"): SendOutcome {
  return {
    ok: true,
    request: req,
    sentAt: "2026-10-22T10:00:00.000Z",
    response: { status, statusText: "", headers: [["content-type", contentType]], body, sizeBytes: body.length, durationMs: ms },
  };
}

function err(ms: number): SendOutcome {
  return { ok: false, request: req, sentAt: "2026-10-22T10:00:01.000Z", error: "connection refused", durationMs: ms };
}

const item = (index: number, outcome: SendOutcome, failed: boolean): BatchItemResult => ({ index, vars: { id: String(index + 1) }, outcome, failed });

describe("entryNotes", () => {
  const opts = DEFAULT_BATCH_OPTIONS;
  it("is empty for a clean 200", () => {
    expect(entryNotes(item(0, ok(200, 5), false), opts)).toEqual([]);
  });
  it("explains HTTP errors depending on the setting", () => {
    expect(entryNotes(item(0, ok(500, 5), true), opts)[0]).toMatch(/HTTP 500 counted as a failure/);
    expect(entryNotes(item(0, ok(404, 5), false), { ...opts, httpErrorsFail: false })[0]).toMatch(/not counted/);
  });
  it("explains connection errors", () => {
    expect(entryNotes(item(0, err(3), true), opts)).toEqual(["No response: connection refused. Counted as a failure."]);
  });
  it("flags unfilled placeholders and bad JSON", () => {
    const o = ok(200, 5, "<html>", "application/json; charset=utf-8");
    const withPlaceholder: SendOutcome = { ...o, request: { ...req, headers: [["Authorization", "Bearer {{token}}"]] } };
    const notes = entryNotes(item(0, withPlaceholder, false), opts);
    expect(notes[0]).toMatch(/\{\{token\}\}/);
    expect(notes[1]).toMatch(/does not parse as JSON/);
  });
});

describe("buildRun and runStats", () => {
  const results = [item(2, ok(200, 30), false), item(0, ok(200, 10), false), item(1, err(20), true)];
  const run = buildRun({
    id: "r1",
    request: { ...newRequest(), name: "Create user", method: "POST", url: "https://a.test/u/{{id}}" },
    csvName: "users.csv",
    columns: ["id"],
    totalRows: 5,
    options: DEFAULT_BATCH_OPTIONS,
    startedAt: "2026-10-22T10:00:00.000Z",
    finishedAt: "2026-10-22T10:00:02.500Z",
    end: "cancelled",
    results,
    missingPlaceholders: ["token"],
  });

  it("sorts entries by row and counts results", () => {
    expect(run.entries.map((e) => e.index)).toEqual([0, 1, 2]);
    expect([run.completed, run.passed, run.failed]).toEqual([3, 2, 1]);
  });

  it("writes a run log", () => {
    const text = run.log.map((l) => l.message).join("\n");
    expect(text).toMatch(/Started POST https:\/\/a.test\/u\/\{\{id\}\} with 5 rows from users.csv/);
    expect(text).toMatch(/No CSV column or environment variable for \{\{token\}\}/);
    expect(text).toMatch(/No environment selected/);
    expect(text).toMatch(/First failure on row 2 \(Error\)/);
    expect(text).toMatch(/Stopped by you/);
    expect(text).toMatch(/3 of 5 sent, 2 passed, 1 failed/);
  });

  it("computes stats", () => {
    const st = runStats(run);
    expect(st).toMatchObject({ completed: 3, passed: 2, failed: 1, connectionErrors: 1, notRun: 2, minMs: 10, avgMs: 20, maxMs: 30, p50Ms: 20, wallMs: 2500 });
    expect(st.statusCounts).toEqual([
      ["200", 2],
      ["Error", 1],
    ]);
  });

  it("cuts very large bodies and says so", () => {
    const big = "x".repeat(MAX_SAVED_BODY + 10);
    const r = buildRun({ ...run, request: run.request, results: [item(0, ok(200, 1, big, "text/plain"), false)], missingPlaceholders: [] });
    const saved = r.entries[0].outcome;
    expect(saved.ok && saved.response.body.length).toBe(MAX_SAVED_BODY);
    expect(r.entries[0].notes.join(" ")).toMatch(/only the first/);
  });
});
