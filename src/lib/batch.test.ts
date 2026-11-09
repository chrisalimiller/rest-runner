import { describe, expect, it } from "vitest";
import { buildRerunInput, failedIndices, rerunDisabledReason, rerunLabel, runBatch, type BatchItemResult, type SendFn } from "./batch";
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

  it("fills environment variables, with CSV columns taking priority", async () => {
    const f = fakeSend(() => 200, 0);
    const results: BatchItemResult[] = [];
    const envDef = { ...def, url: "{{base}}/items/{{id}}" };
    await runBatch(envDef, [{ id: "1" }, { id: "2", base: "https://override" }], opts, f.send, (r) => results.push(r), new AbortController().signal, { base: "https://env", id: "x" });
    expect(results.map((r) => r.outcome.request.url).sort()).toEqual(["https://env/items/1", "https://override/items/2"]);
    expect(results.find((r) => r.index === 0)?.vars).toEqual({ id: "1" });
  });

  it("handles zero rows", async () => {
    const f = fakeSend(() => 200);
    expect(await runBatch(def, [], opts, f.send, () => {}, new AbortController().signal)).toBe("completed");
  });
});

describe("re-running failed rows", () => {
  const item = (index: number, failed: boolean): BatchItemResult => ({
    index,
    vars: { id: String(index + 1) },
    failed,
    outcome: { request: { method: "GET", url: "", headers: [] }, sentAt: "", ok: false, error: "x", durationMs: 1 },
  });
  const results = [item(4, true), item(0, false), item(2, true), item(1, false)];

  it("lists failed row indices in row order", () => {
    expect(failedIndices(results)).toEqual([2, 4]);
    expect(failedIndices([item(0, false)])).toEqual([]);
  });

  it("builds the input from the failed results only, keeping row indices", () => {
    expect(buildRerunInput(results)).toEqual({ rows: [{ id: "3" }, { id: "5" }], indices: [2, 4] });
  });

  it("labels the action and explains when it is unavailable", () => {
    expect(rerunLabel(3)).toBe("Re-run 3 failed");
    expect(rerunDisabledReason(0, false)).toMatch(/no failed/i);
    expect(rerunDisabledReason(2, true)).toMatch(/wait/i);
    expect(rerunDisabledReason(2, false)).toBeNull();
  });

  it("sends only the given rows and reports results under their original indices", async () => {
    const f = fakeSend(() => 200);
    const out: BatchItemResult[] = [];
    const input = buildRerunInput(results);
    const end = await runBatch(def, input.rows, opts, f.send, (r) => out.push(r), new AbortController().signal, {}, undefined, input.indices);
    expect(end).toBe("completed");
    expect(out.map((r) => r.index).sort()).toEqual([2, 4]);
    expect(out.map((r) => r.outcome.request.url).sort()).toEqual(["https://api.test/items/3", "https://api.test/items/5"]);
  });
});
