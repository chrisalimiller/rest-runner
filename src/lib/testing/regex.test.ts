import { afterEach, describe, expect, it, vi } from "vitest";
import { Worker as NodeWorker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { matchRegex } from "./regex";
import { evaluateCondition } from "../flows/conditions";
import { evaluateAssertionAsync } from "./assertions";
import { newAssertion } from "./suites";
import { assertionResults } from "./caseStatus";
import type { CaseResult } from "./types";

// Execute the actual worker source in a real separate thread with a minimal Web Worker adapter.
const source = readFileSync(new URL("./regexWorker.ts", import.meta.url), "utf8")
  .replace(": MessageEvent<{ pattern: string; input: string }>", "");
class ThreadWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  thread: NodeWorker;
  constructor() {
    this.thread = new NodeWorker(`const {parentPort} = require('node:worker_threads'); const self = {postMessage: v => parentPort.postMessage(v)}; ${source}; parentPort.on('message', data => self.onmessage({data}));`, { eval: true });
    this.thread.on("message", data => this.onmessage?.({ data } as MessageEvent));
    this.thread.on("error", () => this.onerror?.());
  }
  postMessage(value: unknown) { this.thread.postMessage(value); }
  terminate() { void this.thread.terminate(); }
}
afterEach(() => vi.unstubAllGlobals());

describe("isolated regex", () => {
  it("evaluates normal and invalid patterns and recovers after a timeout", async () => {
    vi.stubGlobal("Worker", ThreadWorker);
    expect(await matchRegex("^abc-\\d+$", "abc-123")).toBe(true);
    expect(await matchRegex("[", "x")).toMatch(/not a valid/);
    let heartbeat = false;
    setTimeout(() => { heartbeat = true; }, 10);
    expect(await matchRegex("^(a+)+$", "a".repeat(30000) + "!")).toMatch(/timed out/);
    expect(heartbeat).toBe(true);
    expect(await matchRegex("^ok$", "ok")).toBe(true);
  });
  it("handles cancellation and worker startup failure", async () => {
    vi.stubGlobal("Worker", ThreadWorker);
    const controller = new AbortController();
    const pending = matchRegex("^(a+)+$", "a".repeat(30000) + "!", controller.signal);
    controller.abort();
    expect(await pending).toMatch(/cancelled/);
    vi.stubGlobal("Worker", class { constructor() { throw Error(); } });
    expect(await matchRegex("a", "a")).toMatch(/could not start/);
  });
  it("protects assertion and flow conditions", async () => {
    vi.stubGlobal("Worker", ThreadWorker);
    const response = { status: 200, statusText: "OK", headers: [], body: "abc-123", sizeBytes: 7, durationMs: 1 };
    expect((await evaluateAssertionAsync(newAssertion({ source: "body", op: "matches", expected: "^abc-\\d+$" }), response)).passed).toBe(true);
    expect((await evaluateCondition({ source: "variable", property: "x", op: "matches", expected: "^ok$" }, { vars: { x: "ok" }, lastResult: null, lastResponse: null })).passed).toBe(true);
    const assertion = newAssertion({ source: "body", op: "matches", expected: "^abc" });
    const result = { vars: {}, outcome: { ok: true, response } } as unknown as CaseResult;
    expect((await assertionResults([assertion], result)).get(assertion.id)?.passed).toBe(true);
    const failed = await evaluateCondition({ source: "variable", property: "x", op: "matches", expected: "[" }, { vars: { x: "ok" }, lastResult: null, lastResponse: null });
    expect(failed.passed).toBe(false);
    expect(failed.message).toMatch(/not a valid/);
  });
});

