import type { Vars } from "../template";
import { NO_RETRY, type Attempt, type RetrySettings } from "./types";

/** What one try produced, as far as retrying is concerned. */
export interface TryOutcome {
  passed: boolean;
  /** Stop was pressed during the try: no more tries, and the try is not recorded. */
  cancelled: boolean;
  /** The first failed check, or why it could not run. */
  reason?: string;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

export function replaceVars(target: Vars, source: Vars): void {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
}

export interface RetryRun<T extends TryOutcome> {
  /** The last try, or null when Stop was pressed before any try finished. */
  last: T | null;
  /** One entry per finished try. */
  attempts: Attempt[];
}

/**
 * Runs `attempt` until it passes or the extra tries run out. Waits `delayMs` before each extra try,
 * and puts `runVars` back as it was before the first try so every try starts from the same variables.
 * `runVars` is updated in place by the attempts themselves.
 */
export async function runWithRetry<T extends TryOutcome>(
  retry: RetrySettings | undefined,
  runVars: Vars,
  signal: AbortSignal,
  attempt: () => Promise<T>,
): Promise<RetryRun<T>> {
  const times = Math.max(0, Math.floor(retry?.times ?? 0));
  const before = { ...runVars };
  const attempts: Attempt[] = [];
  let last: T | null = null;
  for (let i = 0; i <= times; i++) {
    if (i > 0) {
      await sleep(retry?.delayMs ?? 0, signal);
      if (signal.aborted) break;
      replaceVars(runVars, before);
    }
    const start = Date.now();
    const startedAt = new Date(start).toISOString();
    last = await attempt();
    if (last.cancelled) break;
    attempts.push({ passed: last.passed, startedAt, durationMs: Date.now() - start, reason: last.reason });
    if (last.passed) break;
  }
  return { last, attempts };
}

/** "Passed on try 2 of 3." / "Failed all 3 tries." when more than one try was made; otherwise nothing. */
export function retryNote(attempts: Attempt[], passed: boolean, times: number): string | undefined {
  if (attempts.length < 2) return undefined;
  return passed ? `Passed on try ${attempts.length} of ${times + 1}.` : `Failed all ${attempts.length} tries.`;
}

const wholeNumber = (v: unknown, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
};

/** Retry settings from storage or a file: bad numbers fall back to no retry, and at most 100 extra tries. */
export function cleanRetry(v: unknown): RetrySettings {
  const r = (v && typeof v === "object" ? v : {}) as Partial<RetrySettings>;
  return { times: Math.min(100, wholeNumber(r.times, 0)), delayMs: wholeNumber(r.delayMs, NO_RETRY.delayMs) };
}
