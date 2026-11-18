import { useEffect, useMemo } from "react";
import { createWorkerScriptRunner, type ScriptRunner } from "./scriptRunner";

type Runner = { run: ScriptRunner; dispose: () => void };

/**
 * A script runner that can be attached and detached again. `run` is stable and always uses the
 * runner that is attached now, so a detach followed by an attach (React StrictMode's mount, cleanup,
 * mount in dev builds) gives a working runner instead of a disposed one.
 */
export function createRecyclableScriptRunner(create: () => Runner = createWorkerScriptRunner) {
  let current: Runner | null = null;
  const run: ScriptRunner = (code, ctx, timeoutMs, signal) => {
    if (current) return current.run(code, ctx, timeoutMs, signal);
    const started = Date.now();
    return Promise.resolve({ tests: [], logs: [], vars: ctx.vars, error: "Script worker is unavailable", durationMs: Date.now() - started });
  };
  return {
    run,
    /** Starts a fresh runner. Does nothing when one is already attached. */
    attach() {
      current ??= create();
    },
    /** Cancels any running script and disposes the runner. */
    detach() {
      current?.dispose();
      current = null;
    },
  };
}

/** The script runner for a screen. Created on mount, disposed on unmount, and recreated if React remounts the screen. */
export function useScriptRunner(): { run: ScriptRunner } {
  const runner = useMemo(() => createRecyclableScriptRunner(), []);
  useEffect(() => {
    runner.attach();
    return () => runner.detach();
  }, [runner]);
  return runner;
}
