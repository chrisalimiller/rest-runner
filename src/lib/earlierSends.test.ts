import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import { diffSummary, earlierSendLabel, earlierSends, earlierSendTone, formatMs, previousSend, runIsForRequest, sendTooltip, whenLabel } from "./earlierSends";
import type { RunSummary } from "./run";
import type { HistoryEntry, RequestDef } from "./types";

const def: RequestDef = { ...newRequest(), id: "r1", name: "Create ticket", method: "POST", url: "{{baseUrl}}/t" };

function entry(id: string, defId: string, sentAt: string, status: number | null, durationMs?: number): HistoryEntry {
  return { id, method: "POST", url: "https://x/t", status, sentAt, def: { ...def, id: defId }, durationMs };
}

function run(id: string, startedAt: string, p: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    requestId: "r1",
    requestName: "Create ticket",
    method: "POST",
    urlTemplate: "{{baseUrl}}/t",
    csvName: "a.csv",
    totalRows: 50,
    startedAt,
    finishedAt: startedAt,
    end: "completed",
    options: { concurrency: 1, delayMs: 0, httpErrorsFail: true, stopOnFailure: false },
    completed: 50,
    passed: 48,
    failed: 2,
    ...p,
  };
}

describe("earlierSends", () => {
  it("keeps only sends and batch runs of this request, newest first, up to the limit", () => {
    const history = [
      entry("h1", "r1", "2026-10-22T13:48:00Z", 201, 142),
      entry("h2", "other", "2026-10-22T13:45:00Z", 200),
      entry("h3", "r1", "2026-10-22T13:41:00Z", 422, 98),
    ];
    const runs = [run("b1", "2026-10-22T13:44:00Z"), run("b2", "2026-10-22T13:00:00Z", { requestId: "zzz" })];
    const items = earlierSends(history, runs, def);
    expect(items.map((i) => (i.kind === "send" ? i.entry.id : i.run.id))).toEqual(["h1", "b1", "h3"]);
    expect(earlierSends(history, runs, def, 2)).toHaveLength(2);
  });

  it("matches older runs with no request id by name, method and URL", () => {
    expect(runIsForRequest(run("x", "t", { requestId: undefined }), def)).toBe(true);
    expect(runIsForRequest(run("x", "t", { requestId: undefined, urlTemplate: "/other" }), def)).toBe(false);
  });
});

describe("labels", () => {
  const now = new Date(2026, 9, 22, 13, 48, 30);
  it("formats durations", () => {
    expect(formatMs(142)).toBe("142 ms");
    expect(formatMs(2000)).toBe("2.0 s");
    expect(formatMs(65000)).toBe("1 m 5 s");
  });

  it("says when", () => {
    const at = (...a: [number, number, number, number, number, number?]) => new Date(...a).toISOString();
    expect(whenLabel(at(2026, 9, 22, 13, 48, 25), now)).toBe("now");
    expect(whenLabel(at(2026, 9, 22, 13, 48, 20), now)).toBe("10s ago");
    expect(whenLabel(at(2026, 9, 22, 13, 48, 0), now)).toBe("30s ago");
    expect(whenLabel(at(2026, 9, 22, 13, 44, 30), now)).toBe("4m ago");
    expect(whenLabel(at(2026, 9, 22, 12, 49, 0), now)).toBe("59m ago");
    expect(whenLabel(at(2026, 9, 22, 12, 48, 0), now)).toBe("12:48");
    expect(whenLabel(at(2026, 9, 22, 8, 5, 0), now)).toBe("08:05");
    expect(whenLabel(at(2026, 9, 21, 9, 0, 0), now)).toBe("Yesterday");
    expect(whenLabel(at(2026, 9, 18, 9, 0, 0), now)).toMatch(/Oct\w*\s+18|18\s+Oct/);
    expect(whenLabel("not a date", now)).toBe("");
  });

  it("builds pill text and tone", () => {
    const send = { kind: "send" as const, at: new Date(2026, 9, 22, 13, 30).toISOString(), entry: { ...entry("e", "r1", new Date(2026, 9, 22, 13, 30).toISOString(), null, 2000) } };
    expect(earlierSendLabel(send, now)).toBe("ERR · 2.0 s · 18m ago");
    const dev = { ...send, entry: { ...send.entry, status: 201, environmentName: "Dev" } };
    expect(earlierSendLabel(dev, now, "Dev")).toBe("201 · 2.0 s · 18m ago");
    expect(earlierSendLabel(dev, now, "SIT")).toBe("201 · 2.0 s · 18m ago · Dev");
    expect(earlierSendLabel({ ...dev, entry: { ...dev.entry, environmentName: undefined } }, now, "SIT")).toBe("201 · 2.0 s · 18m ago");
    expect(earlierSendTone(send)).toBe("bad");
    const b = { kind: "batch" as const, at: new Date(2026, 9, 22, 11, 52).toISOString(), run: run("b", new Date(2026, 9, 22, 11, 52).toISOString()) };
    expect(earlierSendLabel(b, now)).toBe("Batch · 48/50 · 11:52");
    expect(earlierSendTone({ ...send, entry: { ...send.entry, status: 422 } })).toBe("warn");
  });
});

describe("diffSummary", () => {
  const base = { ...def, params: [{ id: "1", key: "a", value: "1", enabled: true }], body: "{}" };
  it("names what changed", () => {
    expect(diffSummary(base, { ...base, body: '{"a":1}' })).toBe("body changed");
    expect(diffSummary(base, { ...base, params: [{ id: "1", key: "a", value: "2", enabled: true }] })).toBe("params changed");
    expect(diffSummary(base, { ...base, url: "{{baseUrl}}/other" })).toBe("URL changed");
    expect(diffSummary(base, { ...base, url: "x", body: "y" })).toBe("URL, body changed");
  });
  it("ignores blank rows and returns null when nothing changed", () => {
    expect(diffSummary(base, { ...base, params: [...base.params, { id: "2", key: "", value: "", enabled: true }] })).toBeNull();
  });
});

describe("sendTooltip", () => {
  it("gives environment and the change since the previous send of the same request", () => {
    const older = entry("o", "r1", "2026-10-22T13:00:00Z", 200);
    const newer = { ...entry("n", "r1", "2026-10-22T13:10:00Z", 201), environmentName: "SIT", def: { ...def, body: "changed" } };
    const history = [newer, entry("x", "other", "2026-10-22T13:05:00Z", 200), older];
    expect(previousSend(history, newer)?.id).toBe("o");
    const lines = sendTooltip(newer, history).split("\n");
    expect(lines).toContain("Environment: SIT");
    expect(lines).toContain("Since the previous send: body changed");
    expect(sendTooltip(older, history)).not.toContain("Since the previous send");
  });
});
