import { sendWithScripts } from "./requestScripts";
import type { Vars } from "./template";
import { createWorkerScriptRunner, type ScriptRunner } from "./testing/scriptRunner";
import type { ScriptOutput } from "./testing/types";
import type { PreparedRequest, RequestDef, SendOutcome } from "./types";

const defaultScriptRunner: ScriptRunner = (...args) => createWorkerScriptRunner().run(...args);

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
  /** False when the pre-request script failed and the request was not sent. Missing means sent. */
  sent?: boolean;
  preScript?: ScriptOutput;
  postScript?: ScriptOutput;
  /** Script variables after this row's scripts ran, when the request has scripts. */
  scriptVars?: Vars;
}

export interface BatchScripts {
  runner: ScriptRunner;
  /** Variables each row's scripts start with (for example ones set by earlier single sends). Rows do not share changes. */
  vars?: Vars;
  timeoutMs?: number;
}

export type BatchEnd = "completed" | "cancelled" | "stopped-on-failure";

export type SendFn = (req: PreparedRequest, signal?: AbortSignal) => Promise<SendOutcome>;

/** Leftover script variables give way to the row's own CSV columns; the row's scripts can still override them. */
function withoutColumns(vars: Vars, row: Vars): Vars {
  const out: Vars = {};
  for (const [k, v] of Object.entries(vars)) if (!Object.prototype.hasOwnProperty.call(row, k)) out[k] = v;
  return out;
}

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
  /** Environment variables. A CSV column with the same name takes priority. */
  baseVars: Vars = {},
  /** How to run the request's pre/post scripts. */
  scripts: BatchScripts = { runner: defaultScriptRunner },
  /** CSV row index of each entry in `rows`, for a re-run of some rows. Results keep these indices. Defaults to 0, 1, 2… */
  indices?: number[],
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
      const pos = next++;
      const index = indices?.[pos] ?? pos;
      const vars = rows[pos];
      const r = await sendWithScripts({
        def,
        env: baseVars,
        data: vars,
        vars: withoutColumns(scripts.vars ?? {}, vars),
        iteration: index,
        send,
        scripts: scripts.runner,
        signal,
        timeoutMs: scripts.timeoutMs,
      });
      // A request cut off by Stop is not a result.
      if (!r) break;
      const { outcome } = r;
      const failed = isFailure(outcome, options.httpErrorsFail) || r.scriptFailed;
      if (failed && options.stopOnFailure) stoppedOnFailure = true;
      const scripted = r.preScript || r.postScript ? { sent: r.sent, preScript: r.preScript, postScript: r.postScript, scriptVars: r.vars } : {};
      onResult({ index, vars, outcome, failed, ...scripted });
    }
  };

  await Promise.all(Array.from({ length: workers }, worker));
  if (signal.aborted) return "cancelled";
  if (stoppedOnFailure) return "stopped-on-failure";
  return "completed";
}

/** CSV row indices (0-based, ascending) of the results that failed, including connection errors and rows not sent. */
export function failedIndices(results: Pick<BatchItemResult, "index" | "failed">[]): number[] {
  return results
    .filter((r) => r.failed)
    .map((r) => r.index)
    .sort((a, b) => a - b);
}

export interface RerunInput {
  /** The CSV rows to send, in row order. Taken from the results, so the original file is not needed. */
  rows: Vars[];
  /** Original 0-based CSV row index of each entry in `rows`. */
  indices: number[];
}

/** The rows to send again: only the failed ones, each keeping its original row index. */
export function buildRerunInput(results: Pick<BatchItemResult, "index" | "failed" | "vars">[]): RerunInput {
  const failed = results.filter((r) => r.failed).sort((a, b) => a.index - b.index);
  return { rows: failed.map((r) => r.vars), indices: failed.map((r) => r.index) };
}

export function rerunLabel(count: number): string {
  return `Re-run ${count} failed`;
}

/** Why the re-run action is unavailable, or null when it can be used. */
export function rerunDisabledReason(count: number, running: boolean): string | null {
  if (running) return "Wait for the run to end";
  if (count === 0) return "No failed rows to re-run";
  return null;
}
