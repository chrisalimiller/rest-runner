import { describe, expect, it } from "vitest";
import { BODY_DROPPED, expiredLookupIds, lookupForStorage, MAX_LOOKUP_BODIES, MAX_LOOKUP_BODY, MAX_LOOKUPS_PER_TOOL, trimLookup } from "./lookupStore";
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
    const long = "x".repeat(MAX_LOOKUP_BODY + 100);
    const r = trimLookup(record({}, long));
    expect(r.results[0].response!.body).toHaveLength(MAX_LOOKUP_BODY);
    expect(trimLookup(record({}, "short")).results[0].response!.body).toBe("short");
    expect(r.results[1]).toEqual(record().results[1]);
  });

  it("does not change the live record", () => {
    const live = record({}, "x".repeat(MAX_LOOKUP_BODY + 1));
    lookupForStorage(live, ["supersecret"]);
    expect(live.results[0].response!.body).toHaveLength(MAX_LOOKUP_BODY + 1);
  });
});

describe("lookups of a call that runs once per item", () => {
  const res = (body: string) => ({ status: 200, statusText: "OK", headers: [] as [string, string][], body, sizeBytes: body.length, durationMs: 1 });
  const perItem = (n: number, body: string): LookupRecord =>
    record({
      results: [
        {
          callId: "w",
          name: "W",
          state: "done",
          eachTotal: n,
          each: Array.from({ length: n }, (_, i) => ({ index: i, key: `d${i}`, state: "done" as const, status: 200, response: res(body), sentAt: new Date(2026, 0, 1, 0, 0, i).toISOString() })),
        },
      ],
    });

  it("cuts the body of every item like any other", () => {
    const r = trimLookup(perItem(2, "x".repeat(MAX_LOOKUP_BODY + 5)));
    expect(r.results[0].each!.map((e) => e.response!.body.length)).toEqual([MAX_LOOKUP_BODY, MAX_LOOKUP_BODY]);
  });

  it("drops the oldest bodies first when the whole lookup is too large, and keeps everything else", () => {
    const body = "y".repeat(MAX_LOOKUP_BODY);
    const n = Math.ceil(MAX_LOOKUP_BODIES / MAX_LOOKUP_BODY) + 4;
    const r = trimLookup(perItem(n, body));
    const each = r.results[0].each!;
    expect(each[0].response!.body).toBe(BODY_DROPPED);
    expect(each.at(-1)!.response!.body).toBe(body);
    const kept = each.reduce((total, e) => total + e.response!.body.length, 0);
    expect(kept).toBeLessThanOrEqual(MAX_LOOKUP_BODIES);
    expect(each.map((e) => e.key)).toEqual(Array.from({ length: n }, (_, i) => `d${i}`));
    expect(each.every((e) => e.status === 200 && e.state === "done")).toBe(true);
  });

  it("leaves a lookup under the limit as it is", () => {
    const live = perItem(3, "ok");
    expect(trimLookup(live)).toEqual(live);
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
