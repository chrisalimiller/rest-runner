import type { ScriptContext } from "./sandbox";
import type { ScriptOutput } from "./types";
export type ScriptRunner = (code: string, ctx: ScriptContext, timeoutMs: number, signal?: AbortSignal) => Promise<ScriptOutput>;
export function createWorkerScriptRunner(): { run: ScriptRunner; dispose: () => void } {
  const pending = new Set<() => void>();
  let disposed = false;
  const run: ScriptRunner = (code, ctx, timeoutMs, signal) => new Promise((resolve) => {
    const start = Date.now();
    const failed = (error: string): ScriptOutput => ({ tests: [], logs: [], vars: ctx.vars, error, durationMs: Date.now() - start });
    if (signal?.aborted) { resolve(failed("Script was cancelled")); return; }
    if (disposed || typeof Worker === "undefined") { resolve(failed("Script worker is unavailable")); return; }
    let worker: Worker;
    try { worker = new Worker(new URL("./scriptWorker.ts", import.meta.url), { type: "module" }); }
    catch { resolve(failed("Script worker could not be started")); return; }
    let done = false;
    const finish = (output: ScriptOutput) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pending.delete(cancel);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(output);
    };
    const cancel = () => finish(failed("Script was cancelled"));
    const timer = setTimeout(() => finish(failed(`Script did not finish within ${timeoutMs} ms and was stopped`)), timeoutMs);
    pending.add(cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (e: MessageEvent<{ output: ScriptOutput }>) => finish(e.data.output);
    worker.onerror = (e) => { e.preventDefault(); finish(failed(e.message || "The script could not run")); };
    worker.onmessageerror = () => finish(failed("The script worker returned an invalid message"));
    try { worker.postMessage({ id: 0, code, ctx, timeoutMs }); }
    catch { finish(failed("The script could not be sent to the worker")); }
  });
  return { run, dispose: () => { disposed = true; for (const cancel of [...pending]) cancel(); } };
}
