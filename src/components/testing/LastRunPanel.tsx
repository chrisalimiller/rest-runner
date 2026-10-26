import { maskSecrets, storedSecrets } from "../../lib/secrets";
import { useMemo, useState } from "react";
import { formatMs, whenLabel } from "../../lib/earlierSends";
import { saveTextFile } from "../../lib/saveFile";
import { runFailures } from "../../lib/testing/caseStatus";
import { testReportFileName, toTestCsvReport, toTestHtmlReport } from "../../lib/testing/testReport";
import { testRunTimes, type TestRun } from "../../lib/testing/testRun";
import { LiveRun, type LiveRunState } from "./LiveRun";

interface Props {
  /** The run in progress or just finished for this suite, if any. */
  live: LiveRunState | null;
  /** The latest saved run of this suite. */
  run: TestRun | null;
  onOpenReport: (runId: string, caseId?: string, index?: number) => void;
}

const SHOWN_FAILURES = 8;

/** The right-hand panel: live progress while running, otherwise a summary of the latest run. */
export function LastRunPanel({ live, run, onOpenReport }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const times = useMemo(() => (run ? testRunTimes(run) : null), [run]);
  const failures = useMemo(() => (run ? runFailures(run) : []), [run]);

  // While a run is going, or when it finished but could not be saved, show its live progress.
  if (live && (live.running || !live.runId || !run || run.id !== live.runId)) {
    return (
      <aside className="last-run" aria-label="Current run">
        <div className="last-run-head">
          <span className="section-title">{live.running ? "Running" : "Last run"}</span>
        </div>
        <LiveRun live={live} onOpenReport={(id) => onOpenReport(id)} compact />
      </aside>
    );
  }

  if (!run || !times) {
    return (
      <aside className="last-run" aria-label="Last run">
        <span className="section-title">Last run</span>
        <p className="muted small">No runs yet. Press Run suite to see the results here.</p>
      </aside>
    );
  }

  const exportReport = async (kind: "html" | "csv") => {
    setMessage(null);
    try {
      const content = kind === "html" ? maskSecrets(toTestHtmlReport(run), storedSecrets()) : maskSecrets(toTestCsvReport(run), storedSecrets());
      const result = await saveTextFile(testReportFileName(run, kind), content, kind === "html" ? "HTML report" : "CSV report", kind);
      if (result.saved) setMessage(result.path ? `Saved to ${result.path}` : "Report downloaded.");
    } catch (e) {
      setMessage(`Could not save the report: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const total = run.completed;
  const passPct = total ? (run.passed / total) * 100 : 0;
  const checks = run.checksPassed + run.checksFailed;

  return (
    <aside className="last-run" aria-label="Last run">
      <div className="last-run-head">
        <span className="section-title">Last run · {whenLabel(run.startedAt)}</span>
        <button className="link-btn small" onClick={() => onOpenReport(run.id)}>
          Open report
        </button>
      </div>
      <div className="last-run-big">
        <span className={`mono big-num ${run.failed ? "tone-bad" : "tone-ok"}`}>{run.passed}</span>
        <span className="muted">
          of {total} case{total === 1 ? "" : "s"} passed
        </span>
      </div>
      <div className="pass-bar" aria-hidden>
        <span className="pass" style={{ width: `${passPct}%` }} />
        <span className="fail" style={{ width: `${total ? 100 - passPct : 0}%` }} />
      </div>
      {run.end !== "completed" && <p className="small warning">{run.end === "cancelled" ? "Stopped before the end." : "Stopped after a failure."}</p>}
      <div className="stat-grid">
        <div className="mini-stat">
          <span>Iterations</span>
          <b className="mono">{run.iterations}</b>
        </div>
        <div className="mini-stat">
          <span>Checks</span>
          <b className="mono">
            {run.checksPassed}/{checks}
          </b>
        </div>
        <div className="mini-stat">
          <span>Avg time</span>
          <b className="mono">{formatMs(times.avgMs)}</b>
        </div>
        <div className="mini-stat">
          <span>p95</span>
          <b className="mono">{formatMs(times.p95Ms)}</b>
        </div>
      </div>
      {failures.length > 0 && (
        <div className="failures">
          <span className="section-title">Failures</span>
          <div className="failure-list">
            {failures.slice(0, SHOWN_FAILURES).map((f) => (
              <button key={f.index} className="failure-row" onClick={() => onOpenReport(run.id, f.caseId, f.index)} title="Open the report at this case">
                <span className="mono muted failure-where">{f.where}</span>
                <span className="failure-case">{f.caseName}</span>
                <span className="tone-bad failure-reason">{f.reason}</span>
              </button>
            ))}
          </div>
          {run.failed > SHOWN_FAILURES && (
            <button className="link-btn small" onClick={() => onOpenReport(run.id)}>
              {run.failed - SHOWN_FAILURES} more in the report
            </button>
          )}
        </div>
      )}
      <div className="last-run-exports">
        <button className="secondary" onClick={() => void exportReport("html")}>
          Export HTML
        </button>
        <button className="secondary" onClick={() => void exportReport("csv")}>
          Export CSV
        </button>
      </div>
      {message && <p className="small notice">{message}</p>}
    </aside>
  );
}
