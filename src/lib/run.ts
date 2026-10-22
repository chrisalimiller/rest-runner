import type { BatchEnd, BatchItemResult, BatchOptions } from "./batch";
import { findPlaceholders, type Vars } from "./template";
import type { RequestDef, SendOutcome } from "./types";

/** Response bodies above this size are cut short when a run is saved. */
export const MAX_SAVED_BODY = 1024 * 1024;

export interface RunEntry {
  /** 0-based CSV data row. */
  index: number;
  vars: Vars;
  outcome: SendOutcome;
  failed: boolean;
  /** Plain-language notes about this call, for the explorer and reports. */
  notes: string[];
}

export interface RunLogLine {
  at: string;
  message: string;
}

export interface RunSummary {
  id: string;
  requestName: string;
  method: string;
  urlTemplate: string;
  csvName: string;
  /** Name of the environment used, if any. */
  environmentName?: string;
  totalRows: number;
  startedAt: string;
  finishedAt: string;
  end: BatchEnd;
  options: BatchOptions;
  completed: number;
  passed: number;
  failed: number;
}

export interface Run extends RunSummary {
  request: RequestDef;
  columns: string[];
  log: RunLogLine[];
  entries: RunEntry[];
}

export interface RunStats {
  completed: number;
  passed: number;
  failed: number;
  connectionErrors: number;
  notRun: number;
  statusCounts: [string, number][];
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  wallMs: number;
}

export function durationOf(outcome: SendOutcome): number {
  return outcome.ok ? outcome.response.durationMs : outcome.durationMs;
}

export function statusLabel(outcome: SendOutcome): string {
  return outcome.ok ? String(outcome.response.status) : "Error";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function runStats(run: Run): RunStats {
  const durations = run.entries.map((e) => durationOf(e.outcome)).sort((a, b) => a - b);
  const counts = new Map<string, number>();
  for (const e of run.entries) counts.set(statusLabel(e.outcome), (counts.get(statusLabel(e.outcome)) ?? 0) + 1);
  const passed = run.entries.filter((e) => !e.failed).length;
  const total = durations.reduce((s, d) => s + d, 0);
  return {
    completed: run.entries.length,
    passed,
    failed: run.entries.length - passed,
    connectionErrors: run.entries.filter((e) => !e.outcome.ok).length,
    notRun: run.totalRows - run.entries.length,
    statusCounts: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    minMs: durations[0] ?? 0,
    avgMs: durations.length ? Math.round(total / durations.length) : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations[durations.length - 1] ?? 0,
    wallMs: Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)),
  };
}

function looksJson(contentType: string | undefined): boolean {
  return !!contentType && /[/+]json\b/i.test(contentType);
}

/** Writes the per-call notes that explain what happened with one request. */
export function entryNotes(result: BatchItemResult, options: BatchOptions): string[] {
  const notes: string[] = [];
  const { outcome } = result;
  const req = outcome.request;

  const unfilled = new Set([
    ...findPlaceholders(req.url),
    ...req.headers.flatMap(([k, v]) => [...findPlaceholders(k), ...findPlaceholders(v)]),
    ...findPlaceholders(req.body ?? ""),
  ]);
  if (unfilled.size) {
    notes.push(`Placeholders with no value were sent as written: ${[...unfilled].map((n) => `{{${n}}}`).join(", ")}.`);
  }

  if (!outcome.ok) {
    notes.push(`No response: ${outcome.error}. Counted as a failure.`);
    return notes;
  }

  const res = outcome.response;
  if (res.status >= 400) {
    notes.push(
      options.httpErrorsFail
        ? `HTTP ${res.status} counted as a failure.`
        : `HTTP ${res.status} not counted as a failure ("Count 4xx/5xx as failures" was off).`,
    );
  } else if (res.status >= 300) {
    notes.push(`HTTP ${res.status} redirect was returned and not followed.`);
  }

  const contentType = res.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
  if (looksJson(contentType) && res.body.trim() !== "") {
    try {
      JSON.parse(res.body);
    } catch {
      notes.push(`Response says it is JSON (${contentType}) but the body does not parse as JSON.`);
    }
  }
  if (res.sizeBytes > MAX_SAVED_BODY) {
    notes.push(`Response body is ${res.sizeBytes.toLocaleString()} bytes; only the first ${MAX_SAVED_BODY.toLocaleString()} characters were saved.`);
  }
  return notes;
}

function trimBody(outcome: SendOutcome): SendOutcome {
  if (!outcome.ok || outcome.response.body.length <= MAX_SAVED_BODY) return outcome;
  return { ...outcome, response: { ...outcome.response, body: outcome.response.body.slice(0, MAX_SAVED_BODY) } };
}

export interface RunInput {
  id: string;
  request: RequestDef;
  csvName: string;
  columns: string[];
  totalRows: number;
  options: BatchOptions;
  startedAt: string;
  finishedAt: string;
  end: BatchEnd;
  results: BatchItemResult[];
  /** Placeholders the request uses that neither the CSV nor the environment fills. */
  missingPlaceholders: string[];
  environmentName?: string;
}

function describeOptions(o: BatchOptions): string {
  return [
    `${o.concurrency} concurrent`,
    o.delayMs ? `${o.delayMs} ms delay` : "no delay",
    o.httpErrorsFail ? "4xx/5xx count as failures" : "4xx/5xx do not count as failures",
    o.stopOnFailure ? "stop on first failure" : "keep going after failures",
  ].join(", ");
}

/** Turns the raw results of a batch into a saved run with notes and a run log. */
export function buildRun(input: RunInput): Run {
  const entries: RunEntry[] = [...input.results]
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ ...r, outcome: trimBody(r.outcome), notes: entryNotes(r, input.options) }));
  const passed = entries.filter((e) => !e.failed).length;
  const failed = entries.length - passed;

  const log: RunLogLine[] = [
    { at: input.startedAt, message: `Started ${input.request.method} ${input.request.url} with ${input.totalRows} rows from ${input.csvName}.` },
    { at: input.startedAt, message: `Settings: ${describeOptions(input.options)}.` },
    {
      at: input.startedAt,
      message: input.environmentName ? `Environment: ${input.environmentName}.` : "No environment selected.",
    },
  ];
  if (input.missingPlaceholders.length) {
    log.push({
      at: input.startedAt,
      message: `No CSV column or environment variable for ${input.missingPlaceholders.map((p) => `{{${p}}}`).join(", ")}; these were sent as written.`,
    });
  }
  const firstFailure = entries.filter((e) => e.failed).sort((a, b) => a.outcome.sentAt.localeCompare(b.outcome.sentAt))[0];
  if (firstFailure) {
    log.push({ at: firstFailure.outcome.sentAt, message: `First failure on row ${firstFailure.index + 1} (${statusLabel(firstFailure.outcome)}).` });
  }
  const endMessage =
    input.end === "cancelled"
      ? "Stopped by you before all rows were sent."
      : input.end === "stopped-on-failure"
        ? "Stopped after a failure (\"Stop on first failure\" was on)."
        : "All rows were sent.";
  log.push({ at: input.finishedAt, message: endMessage });
  log.push({
    at: input.finishedAt,
    message: `Finished: ${entries.length} of ${input.totalRows} sent, ${passed} passed, ${failed} failed.`,
  });

  return {
    id: input.id,
    requestName: input.request.name,
    method: input.request.method,
    urlTemplate: input.request.url,
    csvName: input.csvName,
    environmentName: input.environmentName,
    totalRows: input.totalRows,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    end: input.end,
    options: input.options,
    completed: entries.length,
    passed,
    failed,
    request: input.request,
    columns: input.columns,
    log,
    entries,
  };
}

export function summaryOf(run: Run): RunSummary {
  const { request: _r, columns: _c, log: _l, entries: _e, ...summary } = run;
  return summary;
}
