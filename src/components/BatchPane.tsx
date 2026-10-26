import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BATCH_OPTIONS, runBatch, type BatchEnd, type BatchItemResult, type BatchOptions } from "../lib/batch";
import { parseCsv, type CsvData } from "../lib/csv";
import { statusClass } from "../lib/format";
import { sendRequest } from "../lib/http";
import { newId } from "../lib/ids";
import { buildRun, entryNotes, type RunEntry } from "../lib/run";
import { saveRun } from "../lib/runStore";
import { prepareRequest, requestPlaceholders } from "../lib/request";
import { requestScriptRunner } from "../lib/requestScripts";
import type { ScriptExportInput } from "../lib/scriptExport";
import { detectVarSets } from "../lib/testing/varsDetect";
import { load, save } from "../lib/storage";
import type { Vars } from "../lib/template";
import type { RequestDef } from "../lib/types";
import { useCertificates } from "./CertificatesDialog";
import { CallDetail } from "./CallDetail";
import { CsvPreview } from "./CsvPreview";
import { ScriptExportPanel } from "./ScriptExportPanel";

interface Props {
  def: RequestDef;
  envVars: Vars;
  /** Variables set by request scripts on earlier sends. Each row's scripts start with a copy. */
  scriptVars?: Vars;
  envName?: string;
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

export function BatchPane({ def, envVars, scriptVars = NO_VARS, envName, onRunningChange, onWideChange, onRunSaved, onOpenRun }: Props) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [options, setOptions] = useState<BatchOptions>(() => ({ ...DEFAULT_BATCH_OPTIONS, ...load(OPTIONS_KEY, {}) }));
  const [results, setResults] = useState<BatchItemResult[]>([]);
  const [running, setRunning] = useState(false);
  const [end, setEnd] = useState<BatchEnd | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = parseCsv(await f.text());
      setFile({ name: f.name, data });
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

  const start = async () => {
    if (!file || rows.length === 0 || running) return;
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
    const snapshot = structuredClone(def);
    const runOptions = { ...options };
    snapshotRef.current = { def: snapshot, options: runOptions };
    const startVars = { ...scriptVars };
    const all: BatchItemResult[] = [];
    const result = await runBatch(
      snapshot,
      rows,
      runOptions,
      sendRequest,
      (r) => {
        all.push(r);
        bufferRef.current.push(r);
      },
      controller.signal,
      envVars,
      { runner: requestScriptRunner(), vars: startVars },
    );
    const rest = bufferRef.current;
    bufferRef.current = [];
    setResults((r) => r.concat(rest));
    if (all.length > 0) {
      const run = buildRun({
        id: newId(),
        request: snapshot,
        csvName: file.name,
        columns,
        totalRows: rows.length,
        options: runOptions,
        startedAt: new Date(t0).toISOString(),
        finishedAt: new Date().toISOString(),
        end: result,
        results: all,
        missingPlaceholders: missing,
        environmentName: envName,
      });
      try {
        await saveRun(run);
        setSavedRunId(run.id);
        onRunSaved(run.id);
      } catch (e) {
        setSaveError(`The run finished but could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setElapsed(Date.now() - t0);
    setEnd(result);
    setRunning(false);
    abortRef.current = null;
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
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  const avgMs = done
    ? Math.round(results.reduce((s, r) => s + (r.outcome.ok ? r.outcome.response.durationMs : r.outcome.durationMs), 0) / done)
    : 0;

  const sorted = useMemo(() => [...results].sort((a, b) => a.index - b.index), [results]);
  const filtered = filter === "failed" ? sorted.filter((r) => r.failed) : sorted;
  const visible = filtered.slice(0, limit);
  const selectedResult = selected === null ? null : results.find((r) => r.index === selected) ?? null;
  const selectedEntry: RunEntry | null = selectedResult
    ? { ...selectedResult, notes: entryNotes(selectedResult, snapshotRef.current?.options ?? options, snapshotRef.current?.def ?? def) }
    : null;

  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

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
        {file && !wide && <CsvPreview csv={file.data} />}
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
          <label>
            Concurrent requests
            <input
              type="number"
              min={1}
              max={50}
              value={options.concurrency}
              disabled={running}
              onChange={(e) => setOptions({ ...options, concurrency: num(e.target.value, 1, 50) })}
            />
          </label>
          <label>
            Delay between requests (ms)
            <input
              type="number"
              min={0}
              step={100}
              value={options.delayMs}
              disabled={running}
              onChange={(e) => setOptions({ ...options, delayMs: num(e.target.value, 0, 600000) })}
            />
          </label>
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
          <button className="secondary" onClick={() => setShowPreview((s) => !s)} disabled={!file || rows.length === 0 || running}>
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          {running ? (
            <button className="send cancel" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="send" onClick={() => void start()} disabled={!file || rows.length === 0 || def.url.trim() === ""}>
              Run {rows.length || ""} {rows.length === 1 ? "request" : "requests"}
            </button>
          )}
          </div>
        </div>
      </div>

      {showExport && !running && <ScriptExportPanel input={exportInput} />}

      {showPreview && file && (
        <div className="batch-preview">
          <p className="muted small">
            The first {Math.min(3, rows.length)} requests as they will be sent
            {(def.preScript ?? "").trim() ? " (before the pre-request script runs, so values it sets are not filled in yet)" : ""}:
          </p>
          {rows.slice(0, 3).map((vars, i) => {
            const p = prepareRequest(def, { ...envVars, ...scriptVars, ...vars });
            return (
              <pre key={i} className="code-view">
                <span className="muted">Row {i + 1}</span>
                {"\n"}
                {`${p.method} ${p.url}\n`}
                {p.headers.map(([k, v]) => `${k}: ${v}\n`).join("")}
                {p.body ? `\n${p.body}` : ""}
              </pre>
            );
          })}
        </div>
      )}

      {(running || end || results.length > 0) && (
        <div className="batch-progress">
          <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`progress-fill ${failed ? "has-failures" : ""}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="batch-tiles">
            <div className="batch-tile">
              <span className="muted small">{running ? "Running" : end ? describeEnd(end) : ""}</span>
              <strong>
                {done} / {rows.length}
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
                      className={`${selected === r.index ? "selected" : ""} ${r.failed ? "failed" : ""}`}
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
    </section>
  );
}
