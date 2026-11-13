import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRerunInput, DEFAULT_BATCH_OPTIONS,rerunDisabledReason, rerunLabel, runBatch, type BatchEnd, type BatchItemResult, type BatchOptions } from "../lib/batch";
import { RunnerMark } from "./shell/RunnerMark";
import { checkCsvFile, parseCsv, type CsvData } from "../lib/csv";
import { statusClass } from "../lib/format";
import { sendRequest } from "../lib/http";
import { newId } from "../lib/ids";
import { buildRun, entryNotes, type RunEntry } from "../lib/run";
import { getRun, listRuns, saveRun } from "../lib/runStore";
import { loadSelection, matchingRuns, rowStatuses, saveSelection, type RowStatus } from "../lib/rowSelection";
import { prepareRequest, requestPlaceholders } from "../lib/request";
import { requestScriptRunner } from "../lib/requestScripts";
import type { ScriptExportInput } from "../lib/scriptExport";
import { detectVarSets } from "../lib/testing/varsDetect";
import { isPlainObject, load, save } from "../lib/storage";
import type { Vars } from "../lib/template";
import type { RequestDef } from "../lib/types";
import { useCertificates } from "./CertificatesDialog";
import { CallDetail } from "./CallDetail";
import { PresetField } from "./PresetField";
import { ConfirmProductionDialog } from "./shell/ConfirmProductionDialog";
import { RainbowText } from "./RainbowText";
import { RowPicker } from "./RowPicker";
import { ScriptExportPanel } from "./ScriptExportPanel";

interface Props {
  def: RequestDef;
  envVars: Vars;
  /** Variables set by request scripts on earlier sends. Each row's scripts start with a copy. */
  scriptVars?: Vars;
  envName?: string;
  /** Called when a run is about to start: the name of a production environment to confirm, or null to go ahead. */
  confirmProduction?: () => string | null;
  onRunningChange: (running: boolean) => void;
  /** True while a run is going or its results are on screen: the request column gives way to them. */
  onWideChange?: (wide: boolean) => void;
  onRunSaved: (id: string) => void;
  onOpenRun: (id: string) => void;
}

interface LoadedFile {
  name: string;
  data: CsvData;
}

type Filter = "all" | "failed";

const OPTIONS_KEY = "rest-runner.batch-options";
const FLUSH_MS = 150;
const PAGE_SIZE = 500;
const RUNS_FOR_STATUS = 5;

function describeEnd(end: BatchEnd): string {
  if (end === "cancelled") return "Stopped";
  if (end === "stopped-on-failure") return "Stopped after a failure";
  return "Finished";
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

const NO_VARS: Vars = {};

export function BatchPane({ def, envVars, scriptVars = NO_VARS, envName, confirmProduction, onRunningChange, onWideChange, onRunSaved, onOpenRun }: Props) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  /** 0-based CSV rows the next run will send. Remembered per file. */
  const [selected, setSelectedRows] = useState<Set<number>>(new Set());
  /** What the latest saved runs of this request and CSV did with each row. */
  const [statuses, setStatuses] = useState<ReadonlyMap<number, RowStatus>>(new Map());
  const [fileError, setFileError] = useState<string | null>(null);
  const [options, setOptions] = useState<BatchOptions>(() => ({ ...DEFAULT_BATCH_OPTIONS, ...load(OPTIONS_KEY, {}, isPlainObject) }));
  const [results, setResults] = useState<BatchItemResult[]>([]);
  const [running, setRunning] = useState(false);
  const [end, setEnd] = useState<BatchEnd | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedCall, setSelected] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Rows sent by the current run: all CSV rows, or just the failed ones in a re-run. */
  const [total, setTotal] = useState(0);
  /** The request and options a run started with, to write notes for the call detail. */
  const snapshotRef = useRef<{ def: RequestDef; options: BatchOptions } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<BatchItemResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    save(OPTIONS_KEY, options);
  }, [options]);
  useEffect(() => onRunningChange(running), [running, onRunningChange]);
  const wide = running || results.length > 0;
  useEffect(() => onWideChange?.(wide), [wide, onWideChange]);

  // Stable between renders so the row picker, which is expensive for big files, can skip re-rendering.
  const setSelection = useCallback(
    (next: Set<number>) => {
      setSelectedRows(next);
      if (file) saveSelection(file.name, file.data.rows.length, next);
    },
    [file],
  );

  // What earlier saved runs of this request and CSV did with each row, so "not yet run" and "failed" can be picked.
  useEffect(() => {
    if (!file) {
      setStatuses(new Map());
      return;
    }
    let live = true;
    void (async () => {
      try {
        // Only the newest few runs: loading every saved run of a large CSV would be slow and older ones are rarely needed.
        const mine = matchingRuns(await listRuns(), file.name, def.id, def.url).slice(-RUNS_FOR_STATUS);
        const runs = (await Promise.all(mine.map((r) => getRun(r.id)))).filter((r) => r !== undefined);
        if (live) setStatuses(rowStatuses(runs));
      } catch {
        if (live) setStatuses(new Map());
      }
    })();
    return () => {
      live = false;
    };
  }, [file, def.id, def.url, savedRunId]);

  // While running, move buffered results into state a few times a second instead of on every response.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAt);
      if (bufferRef.current.length) {
        const batch = bufferRef.current;
        bufferRef.current = [];
        setResults((r) => r.concat(batch));
      }
    }, FLUSH_MS);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  const placeholders = useMemo(() => requestPlaceholders(def), [def]);
  const columns = file?.data.headers ?? [];
  const fromEnv = placeholders.filter((p) => !columns.includes(p) && Object.prototype.hasOwnProperty.call(envVars, p));
  // Names the pre-request script sets, or that earlier sends' scripts left behind.
  const scriptSet = useMemo(() => new Set([...Object.keys(scriptVars), ...detectVarSets(def.preScript ?? "").map((v) => v.name)]), [scriptVars, def.preScript]);
  const fromScripts = placeholders.filter((p) => !columns.includes(p) && !fromEnv.includes(p) && scriptSet.has(p));
  const missing = placeholders.filter((p) => !columns.includes(p) && !fromEnv.includes(p) && !fromScripts.includes(p));
  const scriptLabel = [(def.preScript ?? "").trim() && "pre-request", (def.postScript ?? "").trim() && "post-response"].filter(Boolean).join(" and ");
  const matched = placeholders.filter((p) => columns.includes(p));
  const unused = columns.filter((c) => !placeholders.includes(c));
  const rows = file?.data.rows ?? [];
  /** The selected rows in file order, dropping any that no longer exist. */
  const chosen = useMemo(() => [...selected].filter((i) => i < rows.length).sort((a, b) => a - b), [selected, rows.length]);

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await f.text();
      const problem = checkCsvFile(f.name, text);
      if (problem) {
        setFileError(problem);
        return;
      }
      const data = parseCsv(text);
      setFile({ name: f.name, data });
      setSelectedRows(loadSelection(f.name, data.rows.length));
      setFileError(data.rows.length === 0 ? "No data rows found. The first line must be the column names." : null);
      setResults([]);
      setEnd(null);
      setSelected(null);
    } catch (e) {
      setFileError(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const [prodAsk, setProdAsk] = useState<{ envName: string; what: string; run: () => void } | null>(null);
  /** Runs now, or after the production confirmation when the active environment is flagged. */
  const guarded = (what: string, run: () => void) => {
    const envName = confirmProduction?.() ?? null;
    if (envName) setProdAsk({ envName, what, run });
    else run();
  };

  const start = () => {
    if (!file || chosen.length === 0 || running) return;
    const runRows = chosen.map((i) => rows[i]);
    guarded(`Run ${chosen.length} ${chosen.length === 1 ? "request" : "requests"}`, () => void execute(def, options, runRows, chosen));
  };

  /** Sends only the failed rows again with the request and options of the run on screen. */
  const rerunFailed = () => {
    const snap = snapshotRef.current;
    if (!snap || running) return;
    const input = buildRerunInput(results);
    if (input.rows.length === 0) return;
    guarded(`Run ${input.rows.length} failed ${input.rows.length === 1 ? "request" : "requests"} again`, () => void execute(snap.def, snap.options, input.rows, input.indices, savedRunId ?? undefined));
  };

  const execute = async (runDef: RequestDef, runOpts: BatchOptions, runRows: Vars[], indices?: number[], rerunOf?: string) => {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    bufferRef.current = [];
    setResults([]);
    setEnd(null);
    setSelected(null);
    setLimit(PAGE_SIZE);
    setShowPreview(false);
    setSavedRunId(null);
    setSaveError(null);
    const t0 = Date.now();
    setStartedAt(t0);
    setElapsed(0);
    setRunning(true);
    setTotal(runRows.length);
    const snapshot = structuredClone(runDef);
    const runOptions = { ...runOpts };
    snapshotRef.current = { def: snapshot, options: runOptions };
    const startVars = { ...scriptVars };
    const all: BatchItemResult[] = [];
    const result = await runBatch(
      snapshot,
      runRows,
      runOptions,
      sendRequest,
      (r) => {
        all.push(r);
        bufferRef.current.push(r);
      },
      controller.signal,
      envVars,
      { runner: requestScriptRunner(), vars: startVars },
      indices,
    );
    const rest = bufferRef.current;
    bufferRef.current = [];
    setResults((r) => r.concat(rest));
    // The run is over whether or not saving it works, so leave "Running" before saving.
    setElapsed(Date.now() - t0);
    setEnd(result);
    setRunning(false);
    abortRef.current = null;
    if (all.length > 0) {
      const run = buildRun({
        id: newId(),
        request: snapshot,
        csvName: file.name,
        columns,
        totalRows: runRows.length,
        options: runOptions,
        startedAt: new Date(t0).toISOString(),
        finishedAt: new Date().toISOString(),
        end: result,
        results: all,
        missingPlaceholders: missing,
        environmentName: envName,
        rerunOf,
      });
      try {
        await saveRun(run);
        setSavedRunId(run.id);
        onRunSaved(run.id);
      } catch (e) {
        setSaveError(`The run finished but could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const stop = () => abortRef.current?.abort();

  const certificates = useCertificates();
  const exportInput = useMemo<ScriptExportInput>(
    () => ({
      def,
      options,
      // Same order as a run in the app: environment, then leftover script variables. CSV columns win over both.
      defaults: { ...envVars, ...scriptVars },
      envName,
      csvName: file?.name,
      certificates,
    }),
    [def, options, envVars, scriptVars, envName, file?.name, certificates],
  );

  const passed = results.filter((r) => !r.failed).length;
  const failed = results.length - passed;
  const done = results.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const avgMs = done
    ? Math.round(results.reduce((s, r) => s + (r.outcome.ok ? r.outcome.response.durationMs : r.outcome.durationMs), 0) / done)
    : 0;

  const sorted = useMemo(() => [...results].sort((a, b) => a.index - b.index), [results]);
  const filtered = filter === "failed" ? sorted.filter((r) => r.failed) : sorted;
  const visible = filtered.slice(0, limit);
  const selectedResult = selectedCall === null ? null : results.find((r) => r.index === selectedCall) ?? null;
  const selectedEntry: RunEntry | null = selectedResult
    ? { ...selectedResult, notes: entryNotes(selectedResult, snapshotRef.current?.options ?? options, snapshotRef.current?.def ?? def) }
    : null;

  const rerunReason = rerunDisabledReason(failed, running);


  return (
    <section className={`batch ${wide ? "wide" : ""}`}>
      <div className="batch-setup">
        <div className="batch-file">
          <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={(e) => void onPick(e.target.files?.[0])} />
          <button className="secondary" onClick={() => inputRef.current?.click()} disabled={running}>
            {file ? "Change CSV…" : "Choose CSV…"}
          </button>
          {file ? (
            <span>
              <strong>{file.name}</strong>{" "}
              <span className="muted">
                · {rows.length} rows · {columns.length} columns
              </span>
            </span>
          ) : (
            <span className="muted">Choose a CSV whose columns match your {"{{placeholders}}"}. Each row becomes one request.</span>
          )}
        </div>

        {fileError && <p className="warning small">{fileError}</p>}
        {file && !wide && <RowPicker key={file.name} csv={file.data} selected={selected} onChange={setSelection} statuses={statuses} hasHistory={statuses.size > 0} disabled={running} />}
        {file?.data.warnings.map((w) => (
          <p key={w} className="warning small">
            {w}
          </p>
        ))}

        {file && (
          <div className="placeholder-check small">
            {placeholders.length === 0 && (
              <span className="warning">
                The request has no {"{{placeholders}}"}, so every row sends the same request.
              </span>
            )}
            {matched.length > 0 && (
              <span>
                Filled from CSV:{" "}
                {matched.map((p) => (
                  <code key={p} className="chip ok">
                    {p}
                  </code>
                ))}
              </span>
            )}
            {fromEnv.length > 0 && (
              <span>
                From {envName ?? "environment"}:{" "}
                {fromEnv.map((p) => (
                  <code key={p} className="chip env">
                    {p}
                  </code>
                ))}
              </span>
            )}
            {fromScripts.length > 0 && (
              <span>
                From scripts:{" "}
                {fromScripts.map((p) => (
                  <code key={p} className="chip env">
                    {p}
                  </code>
                ))}
              </span>
            )}
            {scriptLabel && <span className="muted">The {scriptLabel} {scriptLabel.includes(" and ") ? "scripts run" : "script runs"} for every row.</span>}
            {missing.length > 0 && (
              <span className="warning">
                No column or environment value (sent as written):{" "}
                {missing.map((p) => (
                  <code key={p} className="chip bad">
                    {p}
                  </code>
                ))}
              </span>
            )}
            {unused.length > 0 && (
              <span className="muted">
                Unused columns:{" "}
                {unused.map((p) => (
                  <code key={p} className="chip">
                    {p}
                  </code>
                ))}
              </span>
            )}
          </div>
        )}

        <div className="batch-options">
          <PresetField
            label="Concurrent requests"
            value={options.concurrency}
            presets={[1, 5, 10, 25]}
            min={1}
            max={50}
            step={1}
            disabled={running}
            onChange={(v) => setOptions({ ...options, concurrency: v })}
          />
          <PresetField
            label="Delay between requests"
            value={options.delayMs}
            presets={[0, 100, 250, 500, 1000]}
            min={0}
            max={600000}
            step={100}
            unit="ms"
            format={(v) => (v === 1000 ? "1 s" : `${v} ms`)}
            disabled={running}
            onChange={(v) => setOptions({ ...options, delayMs: v })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={options.httpErrorsFail}
              disabled={running}
              onChange={(e) => setOptions({ ...options, httpErrorsFail: e.target.checked })}
            />
            Count 4xx/5xx as failures
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.stopOnFailure}
              disabled={running}
              onChange={(e) => setOptions({ ...options, stopOnFailure: e.target.checked })}
            />
            Stop on first failure
          </label>
          <div className="run-actions">
          <button
            className="secondary"
            onClick={() => setShowExport((s) => !s)}
            disabled={running || def.url.trim() === ""}
            title="Show this batch as a Python or Bash script to copy or save"
          >
            {showExport ? "Hide export" : "Export script…"}
          </button>
          <button className="secondary" onClick={() => setShowPreview((s) => !s)} disabled={!file || chosen.length === 0 || running}>
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          {running ? (
            <button className="send cancel" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="send" onClick={() => void start()} disabled={!file || chosen.length === 0 || def.url.trim() === ""}>
              {chosen.length === 0 ? "Select rows to run" : `Run ${chosen.length} ${chosen.length === 1 ? "request" : "requests"}`}
            </button>
          )}
          </div>
        </div>
      </div>

      {showExport && !running && <ScriptExportPanel input={exportInput} />}

      {showPreview && file && (
        <div className="batch-preview">
          <p className="muted small">
            The first {Math.min(3, chosen.length)} selected requests as they will be sent
            {(def.preScript ?? "").trim() ? " (before the pre-request script runs, so values it sets are not filled in yet)" : ""}:
          </p>
          {chosen.slice(0, 3).map((i) => {
            const p = prepareRequest(def, { ...envVars, ...scriptVars, ...rows[i] });
            return (
              <pre key={i} className="code-view">
                <span className="muted">Row {i + 1}</span>
                {"\n"}
                {`${p.method} ${p.url}\n`}
                {p.headers.map(([k, v]) => `${k}: ${v}\n`).join("")}
                {p.body ? (
                  <>
                    {"\n"}
                    <RainbowText text={p.body} />
                  </>
                ) : (
                  ""
                )}
              </pre>
            );
          })}
        </div>
      )}

      {(running || end || results.length > 0) && (
        <div className="batch-progress">
          <div className="batch-track" style={{ "--p": Math.min(1, Math.max(0, pct / 100)) } as React.CSSProperties}>
            <RunnerMark live={running} className={running ? "" : "idle"} />
            <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`progress-fill ${failed ? "has-failures" : ""}`} style={{ transform: `scaleX(${Math.min(1, Math.max(0, pct / 100))})` }} />
            </div>
          </div>
          <div className="batch-tiles">
            <div className="batch-tile">
              <span className="muted small">{running ? "Running" : end ? describeEnd(end) : ""}</span>
              <strong>
                {done} / {total}
              </strong>
            </div>
            <div className="batch-tile">
              <span className="muted small">Passed</span>
              <strong className="status ok">{passed}</strong>
            </div>
            <div className="batch-tile">
              <span className="muted small">Failed</span>
              <strong className={failed ? "status bad" : "muted"}>{failed}</strong>
            </div>
            <div className="batch-tile">
              <span className="muted small">Elapsed</span>
              <strong>{formatElapsed(elapsed)}</strong>
            </div>
            <div className="batch-tile">
              <span className="muted small">Average</span>
              <strong>{avgMs} ms</strong>
            </div>
            {savedRunId && !running && (
              <button className="link-btn" onClick={() => onOpenRun(savedRunId)}>
                Open in run explorer and export reports →
              </button>
            )}
          </div>
          {saveError && <p className="warning small">{saveError}</p>}
        </div>
      )}

      {results.length > 0 && (
        <div className="batch-results">
          <div className="results-list">
            <div className="results-toolbar">
              <label className="radio">
                <input type="radio" checked={filter === "all"} onChange={() => { setFilter("all"); setLimit(PAGE_SIZE); }} /> All ({sorted.length})
              </label>
              <label className="radio">
                <input type="radio" checked={filter === "failed"} onChange={() => { setFilter("failed"); setLimit(PAGE_SIZE); }} /> Failed ({failed})
              </label>
              <button
                className="link-btn"
                onClick={() => void rerunFailed()}
                disabled={rerunReason !== null || !snapshotRef.current}
                title={rerunReason ?? "Send only the failed rows again with the same request and options. Saved as a new run; row numbers stay the same."}
                aria-label={rerunReason ? `${rerunLabel(failed)} (unavailable: ${rerunReason})` : `${rerunLabel(failed)} rows again as a new run`}
              >
                {rerunLabel(failed)}
              </button>
            </div>
            <div className="results-scroll">
              <table className="results">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Status</th>
                    <th>Time</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr
                      key={r.index}
                      className={`${selectedCall === r.index ? "selected" : ""} ${r.failed ? "failed" : ""}`}
                      onClick={() => setSelected(r.index)}
                    >
                      <td>{r.index + 1}</td>
                      <td>
                        {r.outcome.ok ? (
                          <span className={`status ${statusClass(r.outcome.response.status)}`}>{r.outcome.response.status}</span>
                        ) : (
                          <span className="status bad" title={r.outcome.error}>
                            {r.sent === false ? "Not sent" : "Error"}
                          </span>
                        )}
                      </td>
                      <td>{r.outcome.ok ? r.outcome.response.durationMs : r.outcome.durationMs} ms</td>
                      <td className="url-cell" title={r.outcome.request.url}>
                        {r.outcome.request.url}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > visible.length && (
                <button className="link-btn show-more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                  Showing {visible.length} of {filtered.length}. Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
                </button>
              )}
            </div>
          </div>
          <div className="result-detail">
            {selectedEntry ? (
              <CallDetail entry={selectedEntry} />
            ) : (
              <p className="muted small">Click a row to see its request and response.</p>
            )}
          </div>
        </div>
      )}
      {prodAsk && (
        <ConfirmProductionDialog
          envName={prodAsk.envName}
          what={prodAsk.what}
          onCancel={() => setProdAsk(null)}
          onConfirm={() => {
            const run = prodAsk.run;
            setProdAsk(null);
            run();
          }}
        />
      )}
    </section>
  );
}
