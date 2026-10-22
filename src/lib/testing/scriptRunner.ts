import { executeScript, type ScriptContext } from "./sandbox";
import type { ScriptOutput } from "./types";

export type ScriptRunner = (code: string, ctx: ScriptContext, timeoutMs: number) => Promise<ScriptOutput>;

/** Runs scripts on the calling thread with no time limit. Used by tests and as a fallback. */
export const inlineScriptRunner: ScriptRunner = async (code, ctx) => executeScript(code, ctx);

/**
 * Runs scripts in a Web Worker so a slow or looping script cannot freeze the window.
 * A script that runs past the time limit has its worker stopped and fails with a timeout.
 */
export function createWorkerScriptRunner(): { run: ScriptRunner; dispose: () => void } {
  if (typeof Worker === "undefined") return { run: inlineScriptRunner, dispose: () => {} };

  const idle: Worker[] = [];
  const all = new Set<Worker>();
  let nextId = 0;

  const make = () => {
    const w = new Worker(new URL("./scriptWorker.ts", import.meta.url), { type: "module" });
    all.add(w);
    return w;
  };
  const kill = (w: Worker) => {
    w.terminate();
    all.delete(w);
  };

  const run: ScriptRunner = (code, ctx, timeoutMs) =>
    new Promise((resolve) => {
      const worker = idle.pop() ?? make();
      const id = nextId++;
      const start = Date.now();
      const finish = (output: ScriptOutput, reusable: boolean) => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (reusable) idle.push(worker);
        else kill(worker);
        resolve(output);
      };
      const failed = (error: string): ScriptOutput => ({ tests: [], logs: [], vars: ctx.vars, error, durationMs: Date.now() - start });
      const onMessage = (e: MessageEvent<{ id: number; output: ScriptOutput }>) => {
        if (e.data.id === id) finish(e.data.output, true);
      };
      const onError = (e: ErrorEvent) => {
        e.preventDefault();
        finish(failed(e.message || "The script could not run"), false);
      };
      const timer = setTimeout(() => finish(failed(`Script did not finish within ${timeoutMs} ms and was stopped`), false), timeoutMs);
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ id, code, ctx });
    });

  return {
    run,
    dispose: () => {
      for (const w of [...all]) kill(w);
      idle.length = 0;
    },
  };
}
