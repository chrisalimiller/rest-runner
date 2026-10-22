import { prepareRequest } from "./request";
import type { Vars } from "./template";
import type { PreparedRequest, RequestDef, SendOutcome } from "./types";

export interface BatchOptions {
  /** How many requests may be in flight at once. */
  concurrency: number;
  /** Pause before each request after the first, per worker. With concurrency 1 this is the gap between requests. */
  delayMs: number;
  /** Stop starting new requests after the first failure. */
  stopOnFailure: boolean;
  /** Count 4xx and 5xx responses as failures (connection errors always are). */
  httpErrorsFail: boolean;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  concurrency: 5,
  delayMs: 0,
  stopOnFailure: false,
  httpErrorsFail: true,
};

export interface BatchItemResult {
  /** 0-based position of the CSV data row. */
  index: number;
  vars: Vars;
  outcome: SendOutcome;
  failed: boolean;
}

export type BatchEnd = "completed" | "cancelled" | "stopped-on-failure";

export type SendFn = (req: PreparedRequest, signal?: AbortSignal) => Promise<SendOutcome>;

export function isFailure(outcome: SendOutcome, httpErrorsFail: boolean): boolean {
  if (!outcome.ok) return true;
  return httpErrorsFail && outcome.response.status >= 400;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
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

/**
 * Sends one request per row, filling {{column}} placeholders from that row.
 * Results are reported through onResult as each request finishes (not in row order).
 */
export async function runBatch(
  def: RequestDef,
  rows: Vars[],
  options: BatchOptions,
  send: SendFn,
  onResult: (result: BatchItemResult) => void,
  signal: AbortSignal,
): Promise<BatchEnd> {
  let next = 0;
  let stoppedOnFailure = false;
  const workers = Math.max(1, Math.min(Math.floor(options.concurrency) || 1, rows.length));

  const worker = async () => {
    let first = true;
    while (!signal.aborted && !stoppedOnFailure && next < rows.length) {
      if (!first) {
        await sleep(options.delayMs, signal);
        if (signal.aborted || stoppedOnFailure || next >= rows.length) break;
      }
      first = false;
      const index = next++;
      const vars = rows[index];
      const outcome = await send(prepareRequest(def, vars), signal);
      // A request cut off by Stop is not a result.
      if (signal.aborted && !outcome.ok) break;
      const failed = isFailure(outcome, options.httpErrorsFail);
      if (failed && options.stopOnFailure) stoppedOnFailure = true;
      onResult({ index, vars, outcome, failed });
    }
  };

  await Promise.all(Array.from({ length: workers }, worker));
  if (signal.aborted) return "cancelled";
  if (stoppedOnFailure) return "stopped-on-failure";
  return "completed";
}
