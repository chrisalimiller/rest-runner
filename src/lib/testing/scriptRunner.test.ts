import { describe, expect, it } from "vitest";
import { createWorkerScriptRunner } from "./scriptRunner";
import type { ScriptContext } from "./sandbox";
const ctx: ScriptContext = { phase: "pre", vars: {}, data: {}, env: {}, iteration: 0, caseName: "", request: { method: "GET", url: "", headers: [] } };
describe("worker runner", () => {
  it("fails closed when workers are unavailable", async () => {
    const runner = createWorkerScriptRunner();
    const out = await runner.run("rr.vars.set('x', 'y')", ctx, 100);
    expect(out.error).toMatch(/unavailable/);
    expect(out.vars).toEqual({});
  });
});

it("terminates an active worker on cancellation", async () => {
  const original = globalThis.Worker;
  let terminated = false;
  class FakeWorker {
    onmessage = null; onerror = null; onmessageerror = null;
    postMessage() {}
    terminate() { terminated = true; }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    const runner = createWorkerScriptRunner();
    const controller = new AbortController();
    const result = runner.run("while(true){}", ctx, 1000, controller.signal);
    controller.abort();
    expect((await result).error).toMatch(/cancelled/);
    expect(terminated).toBe(true);
  } finally { globalThis.Worker = original; }
});
