import { sendWithScripts } from "./requestScripts";
import type { Vars } from "./template";
import { inlineScriptRunner, type ScriptRunner } from "./testing/scriptRunner";
import type { ScriptOutput } from "./testing/types";
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
  scripts: BatchScripts = { runner: inlineScriptRunner },
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
