import { describe, expect, it } from "vitest";
import { runBatch, type BatchItemResult, type SendFn } from "./batch";
import { newRequest } from "./defaults";
import type { PreparedRequest, SendOutcome } from "./types";

const def = { ...newRequest(), url: "https://api.test/items/{{id}}" };
const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1) }));

function fakeSend(statusFor: (req: PreparedRequest) => number | "error", delay = 5) {
  let inFlight = 0;
  let maxInFlight = 0;
  const send: SendFn = async (req, signal) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, delay));
    inFlight -= 1;
    if (signal?.aborted) {
      return { request: req, sentAt: "", ok: false, error: "Request cancelled", durationMs: delay } satisfies SendOutcome;
    }
    const status = statusFor(req);
    const base = { request: req, sentAt: new Date().toISOString() };
    if (status === "error") return { ...base, ok: false, error: "boom", durationMs: delay } satisfies SendOutcome;
    return {
      ...base,
      ok: true,
      response: { status, statusText: "", headers: [], body: "", sizeBytes: 0, durationMs: delay },
    } satisfies SendOutcome;
  };
  return { send, maxInFlight: () => maxInFlight };
}

const opts = { concurrency: 3, delayMs: 0, stopOnFailure: false, httpErrorsFail: true };

describe("runBatch", () => {
  it("sends one request per row with placeholders filled, within the concurrency limit", async () => {
    const f = fakeSend(() => 200);
    const results: BatchItemResult[] = [];
    const end = await runBatch(def, rows, opts, f.send, (r) => results.push(r), new AbortController().signal);
    expect(end).toBe("completed");
    expect(results).toHaveLength(10);
    expect(results.map((r) => r.outcome.request.url).sort()).toEqual(rows.map((r) => `https://api.test/items/${r.id}`).sort());
    expect(f.maxInFlight()).toBe(3);
    expect(results.every((r) => !r.failed)).toBe(true);
  });

  it("marks HTTP errors as failures only when asked", async () => {
    const f = fakeSend((req) => (req.url.endsWith("/2") ? 500 : 200));
    const a: BatchItemResult[] = [];
    await runBatch(def, rows, opts, f.send, (r) => a.push(r), new AbortController().signal);
    expect(a.filter((r) => r.failed).map((r) => r.index)).toEqual([1]);
    const b: BatchItemResult[] = [];
    await runBatch(def, rows, { ...opts, httpErrorsFail: false }, f.send, (r) => b.push(r), new AbortController().signal);
    expect(b.filter((r) => r.failed)).toEqual([]);
  });

  it("stops starting new requests after a failure when stopOnFailure is on", async () => {
    const f = fakeSend((req) => (req.url.endsWith("/2") ? "error" : 200));
    const results: BatchItemResult[] = [];
    const end = await runBatch(def, rows, { ...opts, concurrency: 1, stopOnFailure: true }, f.send, (r) => results.push(r), new AbortController().signal);
    expect(end).toBe("stopped-on-failure");
    expect(results.map((r) => r.index)).toEqual([0, 1]);
  });

  it("cancels", async () => {
    const f = fakeSend(() => 200, 20);
    const controller = new AbortController();
    const results: BatchItemResult[] = [];
    const p = runBatch(def, rows, { ...opts, concurrency: 2 }, f.send, (r) => results.push(r), controller.signal);
    setTimeout(() => controller.abort(), 30);
    expect(await p).toBe("cancelled");
    expect(results.length).toBeLessThan(10);
    expect(results.every((r) => r.outcome.ok)).toBe(true);
  });

  it("waits between requests when a delay is set", async () => {
    const f = fakeSend(() => 200, 0);
    const start = Date.now();
    await runBatch(def, rows.slice(0, 4), { ...opts, concurrency: 1, delayMs: 30 }, f.send, () => {}, new AbortController().signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(85);
  });

  it("handles zero rows", async () => {
    const f = fakeSend(() => 200);
    expect(await runBatch(def, [], opts, f.send, () => {}, new AbortController().signal)).toBe("completed");
  });
});
