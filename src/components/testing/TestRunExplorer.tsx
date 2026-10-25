import { useEffect, useMemo, useState } from "react";
import { saveTextFile } from "../../lib/saveFile";
import { describeMode } from "../../lib/testing/describe";
import { testReportFileName, toTestCsvReport, toTestHtmlReport } from "../../lib/testing/testReport";
import { caseStats, testRunTimes, type TestRun } from "../../lib/testing/testRun";
import { getTestRun } from "../../lib/testing/testRunStore";
import { CaseResultView } from "./CaseResultView";
import { ResultRow, resultStatus } from "./ResultRow";

interface Props {
  /** A saved test run to load. */
  runId?: string;
  /** Or a run already in hand (a flow step's report). */
  preloaded?: TestRun;
  onBack: () => void;
  backLabel?: string;
  /** Missing hides Delete (a flow step's report is part of its flow run). */
  onDelete?: (id: string) => void;
  /** Open with the list filtered to this case, and this result selected (an index into the run's results). */
  initialCaseId?: string;
  initialIndex?: number;
}

type Filter = "all" | "passed" | "failed";
const PAGE_SIZE = 500;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

/** A saved test run: summary, per-case breakdown, run log, and every case result. */
export function TestRunExplorer({ runId, preloaded, onBack, backLabel = "← Back to suite", onDelete, initialCaseId, initialIndex }: Props) {
  const [run, setRun] = useState<TestRun | null | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const [caseFilter, setCaseFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showLog, setShowLog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRun(undefined);
    setCaseFilter(initialCaseId ?? null);
    (preloaded ? Promise.resolve(preloaded) : runId ? getTestRun(runId) : Promise.resolve(undefined))
      .then((r) => {
        if (!live) return;
        setRun(r ?? null);
        const firstFail = r?.results.findIndex((x) => !x.passed) ?? -1;
        const wanted = initialIndex !== undefined && r && initialIndex < r.results.length ? initialIndex : null;
        setSelected(r && r.results.length ? (wanted ?? Math.max(0, firstFail)) : null);
      })
      .catch(() => live && setRun(null));
    return () => {
      live = false;
    };
  }, [runId, preloaded, initialCaseId, initialIndex]);

  const perCase = useMemo(() => (run ? caseStats(run) : []), [run]);
  const times = useMemo(() => (run ? testRunTimes(run) : null), [run]);

  const filtered = useMemo(() => {
    if (!run) return [];
    const q = query.trim().toLowerCase();
    return run.results
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => {
        if (filter === "passed" && !r.passed) return false;
        if (filter === "failed" && r.passed) return false;
        if (caseFilter && r.caseId !== caseFilter) return false;
        if (!q) return true;
        const hay = `${r.iteration + 1} ${r.caseName} ${resultStatus(r).label} ${r.outcome?.request.url ?? ""} ${Object.values(r.vars).join(" ")} ${r.checks
          .map((c) => `${c.name} ${c.message ?? ""}`)
          .join(" ")} ${r.notes.join(" ")}`;
        return hay.toLowerCase().includes(q);
      });
  }, [run, filter, caseFilter, query]);

  useEffect(() => setLimit(PAGE_SIZE), [filter, caseFilter, query]);

  if (run === undefined) return <section className="explorer muted">Loading test run…</section>;
  if (run === null || !times)
    return (
      <section className="explorer">
        <button className="link-btn" onClick={onBack}>
          {backLabel}
        </button>
        <p className="muted">This test run could not be found. It may have been removed.</p>
      </section>
    );

  const visible = filtered.slice(0, limit);
  const picked = selected !== null ? run.results[selected] : null;
  const endLabel = run.end === "cancelled" ? "Stopped by you" : run.end === "stopped-on-failure" ? "Stopped after a failure" : "Completed";

  const exportReport = async (kind: "html" | "csv") => {
    setMessage(null);
    try {
      const content = kind === "html" ? toTestHtmlReport(run) : toTestCsvReport(run);
      const result = await saveTextFile(testReportFileName(run, kind), content, kind === "html" ? "HTML report" : "CSV report", kind);
      if (result.saved) setMessage(result.path ? `Saved to ${result.path}` : "Report downloaded.");
    } catch (e) {
      setMessage(`Could not save the report: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = visible.findIndex((v) => v.index === selected);
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) setSelected(next.index);
  };

  const totalChecks = run.checksPassed + run.checksFailed;

  return (
    <section className="explorer">
      <div className="explorer-head">
        <div>
          <button className="link-btn" onClick={onBack}>
            {backLabel}
          </button>
          <h2>{run.suiteName}</h2>
          <p className="muted small">
            {new Date(run.startedAt).toLocaleString()} · {run.iterations} iteration{run.iterations === 1 ? "" : "s"}
            {run.csvName ? ` from ${run.csvName}` : ""}
            {run.environmentName ? ` · ${run.environmentName}` : ""} · {describeMode(run.options)} · {endLabel}
          </p>
        </div>
        <div className="explorer-actions">
          <button className="secondary" onClick={() => void exportReport("html")}>
            Export HTML report
          </button>
          <button className="secondary" onClick={() => void exportReport("csv")}>
            Export CSV report
          </button>
          {onDelete && (
            <button
              className="secondary danger"
              onClick={() => {
                if (window.confirm("Delete this test run? Exported reports are not affected.")) onDelete(run.id);
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {message && <p className="small save-message">{message}</p>}

      <div className="stat-cards">
        <div className="stat">
          <b>
            {run.completed} / {run.plannedCases}
          </b>
          <span>cases ran</span>
        </div>
        <div className="stat">
          <b className="status ok">{run.passed}</b>
          <span>passed</span>
        </div>
        <div className="stat">
          <b className={run.failed ? "status bad" : ""}>{run.failed}</b>
          <span>failed</span>
        </div>
        <div className="stat">
          <b className={run.checksFailed ? "status bad" : ""}>
            {run.checksPassed} / {totalChecks}
          </b>
          <span>checks passed</span>
        </div>
        <div className="stat">
          <b>{formatDuration(times.wallMs)}</b>
          <span>total time</span>
        </div>
        <div className="stat">
          <b>{times.avgMs} ms</b>
          <span>avg · p95 {times.p95Ms} ms</span>
        </div>
      </div>

      <div className="case-summary">
        <table className="results">
          <thead>
            <tr>
              <th>#</th>
              <th>Test case</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Avg</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            {perCase.map((c) => (
              <tr
                key={c.caseId}
                className={caseFilter === c.caseId ? "selected" : ""}
                onClick={() => setCaseFilter(caseFilter === c.caseId ? null : c.caseId)}
                title="Show only this case's results"
              >
                <td>{c.caseIndex + 1}</td>
                <td>
                  <span className={`pass-mark ${c.failed ? "bad" : "ok"}`}>{c.failed ? "✕" : "✓"}</span> {c.caseName}
                </td>
                <td className="status ok">{c.passed}</td>
                <td className={c.failed ? "status bad" : "muted"}>{c.failed}</td>
                <td>{c.avgMs} ms</td>
                <td>{c.maxMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="explorer-meta small">
        {caseFilter && (
          <button className="chip active" onClick={() => setCaseFilter(null)}>
            Case: {perCase.find((c) => c.caseId === caseFilter)?.caseName} ×
          </button>
        )}
        <button className="link-btn" onClick={() => setShowLog((v) => !v)}>
          {showLog ? "Hide run log" : `Show run log (${run.log.length})`}
        </button>
      </div>
      {showLog && (
        <ul className="run-log small">
          {run.log.map((l, i) => (
            <li key={i}>
              <time>{new Date(l.at).toLocaleTimeString()}</time> {l.message}
            </li>
          ))}
        </ul>
      )}

      <div className="explorer-body">
        <div className="results-list">
          <div className="results-toolbar">
            {(["all", "passed", "failed"] as const).map((f) => (
              <label key={f} className="radio">
                <input type="radio" checked={filter === f} onChange={() => setFilter(f)} />
                {f === "all" ? `All (${run.completed})` : f === "passed" ? `Passed (${run.passed})` : `Failed (${run.failed})`}
              </label>
            ))}
            <input className="search" type="search" placeholder="Search case, URL, value, check" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="results-scroll" tabIndex={0} onKeyDown={onKeyDown}>
            <table className="results test-results">
              <thead>
                <tr>
                  <th>Iter.</th>
                  <th>Case</th>
                  <th>Status</th>
                  <th>Checks</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ r, index }) => (
                  <ResultRow key={index} result={r} selected={selected === index} onSelect={() => setSelected(index)} />
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="muted small pad">No results match.</p>}
            {filtered.length > visible.length && (
              <button className="link-btn show-more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Showing {visible.length} of {filtered.length}. Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
              </button>
            )}
          </div>
        </div>
        <div className="result-detail">
          {picked ? (
            <CaseResultView key={selected} result={picked} title={`${picked.caseName} · iteration ${picked.iteration + 1}${picked.rowIndex !== null ? ` (row ${picked.rowIndex + 1})` : ""}`} />
          ) : (
            <p className="muted small">Select a result to see its details.</p>
          )}
        </div>
      </div>
    </section>
  );
}
