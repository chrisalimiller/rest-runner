import { useEffect, useMemo, useState } from "react";
import { statusClass } from "../lib/format";
import { toCsvReport, toHtmlReport, reportFileName } from "../lib/report";
import { durationOf, runStats, statusLabel, type Run } from "../lib/run";
import { getRun } from "../lib/runStore";
import { saveTextFile } from "../lib/saveFile";
import { CallDetail } from "./CallDetail";

interface Props {
  runId: string;
  onBack: () => void;
  onDelete: (id: string) => void;
  /** Loads the request this run was made from into the editor. */
  onLoadRequest?: (run: Run) => void;
}

type ResultFilter = "all" | "passed" | "failed";
const PAGE_SIZE = 500;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

export function RunExplorer({ runId, onBack, onDelete, onLoadRequest }: Props) {
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showLog, setShowLog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRun(undefined);
    getRun(runId)
      .then((r) => {
        if (!live) return;
        setRun(r ?? null);
        setSelected(r?.entries[0]?.index ?? null);
      })
      .catch(() => live && setRun(null));
    return () => {
      live = false;
    };
  }, [runId]);

  const stats = useMemo(() => (run ? runStats(run) : null), [run]);

  const filtered = useMemo(() => {
    if (!run) return [];
    const q = query.trim().toLowerCase();
    return run.entries.filter((e) => {
      if (filter === "passed" && e.failed) return false;
      if (filter === "failed" && !e.failed) return false;
      if (status && statusLabel(e.outcome) !== status) return false;
      if (!q) return true;
      const hay = `${e.index + 1} ${statusLabel(e.outcome)} ${e.outcome.request.url} ${Object.values(e.vars).join(" ")} ${e.notes.join(" ")} ${[...(e.preScript?.logs ?? []), ...(e.postScript?.logs ?? [])].join(" ")}`;
      return hay.toLowerCase().includes(q);
    });
  }, [run, filter, status, query]);

  useEffect(() => setLimit(PAGE_SIZE), [filter, status, query]);

  if (run === undefined) return <section className="explorer muted">Loading run…</section>;
  if (run === null || !stats)
    return (
      <section className="explorer">
        <button className="link-btn" onClick={onBack}>
          ← Back to request
        </button>
        <p className="muted">This run could not be found. It may have been removed.</p>
      </section>
    );

  const visible = filtered.slice(0, limit);
  const entry = run.entries.find((e) => e.index === selected) ?? null;

  const exportReport = async (kind: "html" | "csv") => {
    setMessage(null);
    try {
      const content = kind === "html" ? toHtmlReport(run) : toCsvReport(run);
      const result = await saveTextFile(reportFileName(run, kind), content, kind === "html" ? "HTML report" : "CSV report", kind);
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

  const endLabel = run.end === "cancelled" ? "Stopped by you" : run.end === "stopped-on-failure" ? "Stopped after a failure" : "Completed";

  return (
    <section className="explorer">
      <div className="explorer-head">
        <div>
          <button className="link-btn" onClick={onBack}>
            ← Back to request
          </button>
          <h2>{run.requestName}</h2>
          <p className="muted small">
            {new Date(run.startedAt).toLocaleString()} · {run.method} <span className="mono">{run.urlTemplate}</span> · {run.csvName}
            {run.environmentName ? ` · ${run.environmentName}` : ""} · {endLabel}
          </p>
        </div>
        <div className="explorer-actions">
          {onLoadRequest && (
            <button className="secondary" onClick={() => onLoadRequest(run)} title="Open the request as it was when this run started">
              Load this request
            </button>
          )}
          <button className="secondary" onClick={() => void exportReport("html")}>
            Export HTML report
          </button>
          <button className="secondary" onClick={() => void exportReport("csv")}>
            Export CSV report
          </button>
          <button
            className="secondary danger"
            onClick={() => {
              if (window.confirm("Delete this run? Exported reports are not affected.")) onDelete(run.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {message && <p className="small save-message">{message}</p>}

      <div className="stat-cards">
        <div className="stat">
          <b>
            {stats.completed} / {run.totalRows}
          </b>
          <span>sent</span>
        </div>
        <div className="stat">
          <b className="status ok">{stats.passed}</b>
          <span>passed</span>
        </div>
        <div className="stat">
          <b className={stats.failed ? "status bad" : ""}>{stats.failed}</b>
          <span>failed{stats.connectionErrors ? ` (${stats.connectionErrors} no response)` : ""}</span>
        </div>
        <div className="stat">
          <b>{formatDuration(stats.wallMs)}</b>
          <span>total time</span>
        </div>
        <div className="stat">
          <b>{stats.avgMs} ms</b>
          <span>average</span>
        </div>
        <div className="stat">
          <b>{stats.p95Ms} ms</b>
          <span>95th percentile</span>
        </div>
      </div>

      <div className="explorer-meta small">
        <span className="muted">Status codes:</span>
        {stats.statusCounts.map(([s, n]) => (
          <button
            key={s}
            className={`chip ${status === s ? "active" : ""} ${s === "Error" || Number(s) >= 400 ? "bad" : Number(s) < 300 ? "ok" : ""}`}
            onClick={() => setStatus(status === s ? null : s)}
            title="Filter by this status"
          >
            {s} × {n}
          </button>
        ))}
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
                {f === "all" ? `All (${stats.completed})` : f === "passed" ? `Passed (${stats.passed})` : `Failed (${stats.failed})`}
              </label>
            ))}
            <input
              className="search"
              type="search"
              placeholder="Search row, URL, value, note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="results-scroll" tabIndex={0} onKeyDown={onKeyDown}>
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
                {visible.map((e) => (
                  <tr key={e.index} className={`${selected === e.index ? "selected" : ""} ${e.failed ? "failed" : ""}`} onClick={() => setSelected(e.index)}>
                    <td>
                      {e.index + 1}
                      {e.notes.length > 0 && <span className="note-dot" title={e.notes.join("\n")}> ●</span>}
                    </td>
                    <td>
                      <span className={`status ${e.outcome.ok ? statusClass(e.outcome.response.status) : "bad"}`}>{statusLabel(e.outcome)}</span>
                    </td>
                    <td>{durationOf(e.outcome)} ms</td>
                    <td className="url-cell" title={e.outcome.request.url}>
                      {e.outcome.request.url}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="muted small pad">No calls match.</p>}
            {filtered.length > visible.length && (
              <button className="link-btn show-more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Showing {visible.length} of {filtered.length}. Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
              </button>
            )}
          </div>
        </div>
        <div className="result-detail">{entry ? <CallDetail entry={entry} /> : <p className="muted small">Select a call to see its details.</p>}</div>
      </div>
    </section>
  );
}
