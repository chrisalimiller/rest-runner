import { triggerText } from "../../lib/flows/scheduleChip";
import { OverflowMenu } from "../shell/OverflowMenu";
import { TrashIcon } from "../shell/Icons";
import { currentMasker, maskSecrets, storedSecrets } from "../../lib/secrets";
import { useEffect, useMemo, useState } from "react";
import { formatMs } from "../../lib/earlierSends";
import { getFlowRun } from "../../lib/flows/flowRunStore";
import { END_LABELS, flowReportFileName, flowRunWallMs, orderedSteps, singleCall, stepResultLabel, stepWhere, toFlowCsvReport, toFlowHtmlReport, variableRows } from "../../lib/flows/flowReport";
import { NODE_TYPE_LABELS } from "../../lib/flows/flows";
import type { FlowRun, FlowStep } from "../../lib/flows/types";
import { saveTextFile } from "../../lib/saveFile";
import { CaseResultView } from "../testing/CaseResultView";
import { TestRunExplorer } from "../testing/TestRunExplorer";

interface Props {
  runId: string;
  onBack: () => void;
  onDelete: (id: string) => void;
  /** Show the flow as it was for this run, read-only, with each step's result. */
  onShowCanvas: (run: FlowRun) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

const MARK: Record<FlowStep["status"], string> = { passed: "✓", done: "✓", failed: "✕", cancelled: "■" };

function StepDetail({ step, onOpenChild }: { step: FlowStep; onOpenChild: () => void }) {
  const rows = variableRows(step.varsBefore, step.varsAfter);
  const mask = currentMasker();
  const changed = rows.filter((r) => r.change !== null).length;
  const child = step.child;
  const call = singleCall(step);
  const notSent = !!child && child.results.length === 0;
  return (
    <div className="flow-report-detail">
      <h3>{step.label}</h3>
      <p className="muted small">
        {NODE_TYPE_LABELS[step.nodeType]}
        {stepWhere(step) ? ` · ${stepWhere(step)}` : ""} · started {new Date(step.startedAt).toLocaleTimeString()} · {formatDuration(step.durationMs)}
        {step.output ? ` · left by "${step.output}"` : ""}
      </p>
      {step.notes.length > 0 && (
        <ul className="flow-report-notes small">
          {step.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {step.attempts && step.attempts.length > 1 && (
        <>
          <h4 className="section-title">Tries</h4>
          <ol className="flow-attempts small">
            {step.attempts.map((a, i) => (
              <li key={i} className={a.passed ? "tone-ok" : "tone-bad"}>
                {a.passed ? "passed" : "failed"} · {formatMs(a.durationMs)}
                {a.reason ? ` · ${a.reason}` : ""}
              </li>
            ))}
          </ol>
        </>
      )}
      {call && (
        <div className="flow-report-call">
          <CaseResultView key={step.index} result={call} title={call.caseName} initialTab={call.passed ? "response" : "checks"} />
        </div>
      )}
      {notSent && <p className="muted small">The request was not sent.</p>}
      {child && !call && !notSent && (
        <div className="flow-report-child">
          <span>
            <strong>{child.suiteName}</strong>: {child.passed} of {child.completed} case{child.completed === 1 ? "" : "s"} passed · {child.checksPassed} of{" "}
            {child.checksPassed + child.checksFailed} checks
          </span>
          <button className="secondary" onClick={onOpenChild}>
            Open full report
          </button>
        </div>
      )}
      <h4 className="section-title">
        Variables after this step{" "}
        <span className="muted">{changed === 0 ? "· none changed" : `· ${changed} changed`}</span>
      </h4>
      {rows.length === 0 ? (
        <p className="muted small">No variables yet.</p>
      ) : (
        <table className="kv readonly small flow-var-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={r.change ? `var-${r.change}` : undefined}>
                <td>{r.name}</td>
                <td>{r.change === "removed" ? <s>{mask(r.value)}</s> : mask(r.value)}</td>
                <td className="var-change">{r.change ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A saved flow run: summary, run log, every step, and each Run step's full test report. */
export function FlowRunReport({ runId, onBack, onDelete, onShowCanvas }: Props) {
  const [run, setRun] = useState<FlowRun | null | undefined>(undefined);
  const [selected, setSelected] = useState<number | null>(null);
  const [child, setChild] = useState<number | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRun(undefined);
    setChild(null);
    getFlowRun(runId)
      .then((r) => {
        if (!live) return;
        setRun(r ?? null);
        const steps = r ? orderedSteps(r) : [];
        const firstFail = steps.find((s) => s.status === "failed");
        setSelected(firstFail?.index ?? steps[0]?.index ?? null);
      })
      .catch(() => live && setRun(null));
    return () => {
      live = false;
    };
  }, [runId]);

  const steps = useMemo(() => (run ? orderedSteps(run) : []), [run]);
  const shown = onlyFailed ? steps.filter((s) => s.status === "failed") : steps;

  if (run === undefined) return <section className="explorer muted">Loading flow run…</section>;
  if (run === null)
    return (
      <section className="explorer">
        <button className="link-btn" onClick={onBack}>
          ← Back to flow
        </button>
        <p className="muted">This flow run could not be found. It may have been removed.</p>
      </section>
    );

  const childStep = child !== null ? steps.find((s) => s.index === child) : undefined;
  if (childStep?.child) {
    return <TestRunExplorer preloaded={childStep.child} backLabel={`← Back to the flow run`} onBack={() => setChild(null)} />;
  }

  const picked = selected !== null ? steps.find((s) => s.index === selected) : undefined;
  const exportReport = async (kind: "html" | "csv") => {
    setMessage(null);
    try {
      const content = kind === "html" ? maskSecrets(toFlowHtmlReport(run), storedSecrets()) : maskSecrets(toFlowCsvReport(run), storedSecrets());
      const result = await saveTextFile(flowReportFileName(run, kind), content, kind === "html" ? "HTML report" : "CSV report", kind);
      if (result.saved) setMessage(result.path ? `Saved to ${result.path}` : "Report downloaded.");
    } catch (e) {
      setMessage(`Could not save the report: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section className="explorer flow-report">
      <div className="explorer-head">
        <div>
          <button className="link-btn" onClick={onBack}>
            ← Back to flow
          </button>
          <h2>{run.flowName}</h2>
          <p className="muted small">
            {new Date(run.startedAt).toLocaleString()} · {triggerText(run) ?? "Run button"}
            {run.environmentName ? ` · ${run.environmentName}` : " · No environment"}
          </p>
        </div>
        <div className="explorer-actions">
          <button className="secondary" onClick={() => onShowCanvas(run)}>
            Show on canvas
          </button>
          <button className="secondary" onClick={() => void exportReport("html")}>
            Export HTML report
          </button>
          <button className="secondary" onClick={() => void exportReport("csv")}>
            Export CSV report
          </button>
          <OverflowMenu
            label="Run actions"
            items={[{ label: "Delete run", icon: <TrashIcon />, onSelect: () => onDelete(run.id), danger: true, title: "Exported reports are not affected" }]}
          />
        </div>
      </div>
      {message && <p className="small save-message">{message}</p>}

      <div className="stat-cards">
        <div className="stat">
          <b className={run.end === "passed" ? "status ok" : run.end === "passed-handled" ? "status warn" : run.end === "failed" ? "status bad" : ""}>{END_LABELS[run.end]}</b>
          <span>result</span>
        </div>
        <div className="stat">
          <b>{run.steps}</b>
          <span>steps ran</span>
        </div>
        <div className="stat">
          <b className="status ok">{run.passedSteps}</b>
          <span>run steps passed</span>
        </div>
        <div className="stat">
          <b className={run.failedSteps ? "status bad" : ""}>{run.failedSteps}</b>
          <span>run steps failed</span>
        </div>
        <div className="stat">
          <b>{formatDuration(flowRunWallMs(run))}</b>
          <span>total time</span>
        </div>
      </div>
      {run.endReason && run.end !== "passed" && run.end !== "passed-handled" && <p className="small flow-problem error">{run.endReason}</p>}

      <div className="explorer-meta small">
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
            <label className="radio">
              <input type="radio" checked={!onlyFailed} onChange={() => setOnlyFailed(false)} />
              All ({steps.length})
            </label>
            <label className="radio">
              <input type="radio" checked={onlyFailed} onChange={() => setOnlyFailed(true)} />
              Failed ({steps.filter((s) => s.status === "failed").length})
            </label>
          </div>
          <div className="results-scroll">
            <table className="results flow-report-steps">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Step</th>
                  <th>Where</th>
                  <th>Result</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.index} className={selected === s.index ? "selected" : ""} onClick={() => setSelected(s.index)}>
                    <td className="muted">{s.index + 1}</td>
                    <td>
                      <span className={`flow-step-mark st-${s.status}`}>{MARK[s.status]}</span> {s.label}
                      <span className="muted small"> · {NODE_TYPE_LABELS[s.nodeType]}</span>
                    </td>
                    <td className="muted small">{stepWhere(s)}</td>
                    <td className={s.status === "failed" ? "status bad" : s.status === "passed" ? "status ok" : "muted"}>{stepResultLabel(s)}</td>
                    <td className="muted">{formatMs(s.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="muted small pad">No steps match.</p>}
          </div>
        </div>
        <div className="result-detail">
          {picked ? <StepDetail key={picked.index} step={picked} onOpenChild={() => setChild(picked.index)} /> : <p className="muted small">Select a step to see its details.</p>}
        </div>
      </div>
    </section>
  );
}
