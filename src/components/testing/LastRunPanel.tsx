import { maskSecrets, storedSecrets } from "../../lib/secrets";
import { useMemo, useState } from "react";
import { formatMs, whenLabel } from "../../lib/earlierSends";
import { saveTextFile } from "../../lib/saveFile";
import { groupFailures, type FailureGroup } from "../../lib/testing/testReport";
import { testReportFileName, toTestCsvReport, toTestHtmlReport } from "../../lib/testing/testReport";
import { testRunTimes, type TestRun } from "../../lib/testing/testRun";
import { LiveRun, type LiveRunState } from "./LiveRun";

interface Props {
  /** The run in progress or just finished for this suite, if any. */
  live: LiveRunState | null;
  /** The latest saved run of this suite. */
  run: TestRun | null;
  /** `check` limits the report to one failing check of a case. */
  onOpenReport: (runId: string, caseId?: string, index?: number, check?: string) => void;
}

const SHOWN_GROUPS = 6;

/** "8 of 12 rows · worst 371 ms". */
function groupSummary(g: FailureGroup, total: number, csv: boolean): string {
  const unit = csv ? "row" : "iteration";
  const n = g.rows.length;
  const where = total > 1 ? `${n} of ${total} ${unit}s` : g.count > 1 ? `${g.count} times` : "once";
  return [where, g.worstActual ? `worst ${g.worstActual}` : ""].filter(Boolean).join(" · ");
}

/** The right-hand panel: live progress while running, otherwise a summary of the latest run. */
export function LastRunPanel({ live, run, onOpenReport }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const times = useMemo(() => (run ? testRunTimes(run) : null), [run]);
  const groups = useMemo(() => (run ? groupFailures(run.results) : []), [run]);

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
      {groups.length > 0 && (
        <div className="failures">
          <span className="section-title">Failures</span>
          <div className="failure-list">
            {groups.slice(0, SHOWN_GROUPS).map((g) => (
              <button
                key={`${g.caseId}|${g.checkName}`}
                className="failure-row failure-group"
                onClick={() => onOpenReport(run.id, g.caseId, undefined, g.checkName)}
                title="Open the report filtered to this case and check"
              >
                <span className="failure-case">{g.caseName}</span>
                <span className="tone-bad failure-reason">{g.checkName}</span>
                <span className="muted small failure-count">{groupSummary(g, run.iterations, run.csvName !== undefined)}</span>
              </button>
            ))}
          </div>
          {groups.length > SHOWN_GROUPS && (
            <button className="link-btn small" onClick={() => onOpenReport(run.id)}>
              {groups.length - SHOWN_GROUPS} more in the report
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
