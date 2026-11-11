import { describe, expect, it } from "vitest";
import { MAX_HISTORY_BODY } from "../history";
import { expiredLookupIds, lookupForStorage, MAX_LOOKUPS_PER_TOOL, trimLookup } from "./lookupStore";
import type { LookupRecord } from "./types";

function record(overrides: Partial<LookupRecord> = {}, body = "{}"): LookupRecord {
  return {
    id: "l1",
    toolId: "t1",
    toolName: "Tool",
    startedAt: "2026-01-01T00:00:00.000Z",
    inputs: { id: "42" },
    stopped: false,
    results: [
      { callId: "a", name: "A", state: "done", status: 200, response: { status: 200, statusText: "OK", headers: [["x", "y"]], body, sizeBytes: body.length, durationMs: 3 } },
      { callId: "b", name: "B", state: "network-error", error: "refused" },
    ],
    ...overrides,
  };
}

describe("lookup history limits", () => {
  it("keeps 20 lookups per tool", () => {
    expect(MAX_LOOKUPS_PER_TOOL).toBe(20);
  });

  it("lists the oldest ids past the limit", () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ id: `l${i}`, startedAt: new Date(2026, 0, 1, 0, i).toISOString() }));
    const old = expiredLookupIds(rows.slice().reverse());
    expect(old.sort()).toEqual(["l0", "l1", "l2"]);
    expect(expiredLookupIds(rows.slice(0, 20))).toEqual([]);
  });

  it("cuts long bodies to the size request history keeps, and leaves short ones", () => {
    const long = "x".repeat(MAX_HISTORY_BODY + 100);
    const r = trimLookup(record({}, long));
    expect(r.results[0].response!.body).toHaveLength(MAX_HISTORY_BODY);
    expect(trimLookup(record({}, "short")).results[0].response!.body).toBe("short");
    expect(r.results[1]).toEqual(record().results[1]);
  });

  it("does not change the live record", () => {
    const live = record({}, "x".repeat(MAX_HISTORY_BODY + 1));
    lookupForStorage(live, ["supersecret"]);
    expect(live.results[0].response!.body).toHaveLength(MAX_HISTORY_BODY + 1);
  });
});

describe("secret masking", () => {
  it("masks secret environment values in inputs, bodies, errors and urls, but not the structure", () => {
    const secret = "tok-123456";
    const live = record(
      { inputs: { token: secret } },
      JSON.stringify({ echoed: secret }),
    );
    live.results[1].error = `refused using ${secret}`;
    live.results[0].request = { method: "GET", url: `https://x/?k=${secret}` };
    const stored = lookupForStorage(live, [secret]);
    const text = JSON.stringify(stored);
    expect(text).not.toContain(secret);
    expect(stored.results[0].state).toBe("done");
    expect(stored.results[0].callId).toBe("a");
    expect(stored.results[0].status).toBe(200);
    expect(stored.toolId).toBe("t1");
  });

  it("passes everything through when there are no secrets", () => {
    const live = record();
    expect(lookupForStorage(live, [])).toEqual(live);
  });
});
