import type { SuiteRunOptions } from "./types";

export function describeMode(o: SuiteRunOptions): string {
  const parts = [
    o.mode === "sequential"
      ? "sequential"
      : o.mode === "parallel-iterations"
        ? `iterations in parallel (up to ${o.concurrency} at once), cases in order`
        : `cases in parallel (up to ${o.concurrency} at once)`,
    o.repeat > 1 ? `repeat ${o.repeat}×` : null,
    o.delayMs ? `${o.delayMs} ms delay` : null,
    o.stopOnFailure ? "stop on first failure" : null,
    o.httpErrorsFail ? "4xx/5xx fail a case without its own status check" : "4xx/5xx do not fail a case on their own",
  ];
  return parts.filter(Boolean).join(", ");
}
