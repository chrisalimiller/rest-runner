import { useEffect, useState } from "react";
import { formatMs, whenLabel } from "../../lib/earlierSends";
import type { FlowRunEnd, FlowStep } from "../../lib/flows/types";
import type { FlowProblem } from "../../lib/flows/validate";
import type { Vars } from "../../lib/template";

/** The run in progress, or the finished run being shown, for the open flow. */
export interface FlowRunView {
  flowId: string;
  running: boolean;
  steps: FlowStep[];
  /** Steps running now (several at once inside Parallel). */
  runningNodeIds: string[];
  startedAt: number;
  finishedAt?: number;
  end?: FlowRunEnd;
  endReason?: string;
  passedSteps?: number;
  failedSteps?: number;
  /** Set once the run is saved. */
  runId?: string;
  saveError?: string;
  /** Shown instead of progress when the flow could not start. */
  error?: string;
}

interface Props {
  problems: FlowProblem[];
  run: FlowRunView | null;
  labelFor: (nodeId: string) => string;
  onFocusNode: (nodeId: string) => void;
  /** Opens the saved run's full report. Only given once the run is saved. */
  onOpenReport?: () => void;
}

const END_LABELS: Record<FlowRunEnd, string> = { passed: "Passed", failed: "Failed", cancelled: "Stopped" };

function elapsed(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

function varChanges(before: Vars, after: Vars): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(after)) if (before[k] !== v) out.push(`${k} = ${JSON.stringify(v)}`);
  for (const k of Object.keys(before)) if (!(k in after)) out.push(`${k} removed`);
  return out;
}

function StepRow({ step, onFocus }: { step: FlowStep; onFocus: () => void }) {
  const [open, setOpen] = useState(false);
  const changes = varChanges(step.varsBefore, step.varsAfter);
  const mark = step.status === "passed" || step.status === "done" ? "✓" : step.status === "failed" ? "✕" : "■";
  const child = step.child;
  return (
    <li className={`flow-step st-${step.status}`}>
      <button className="flow-step-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`flow-step-mark st-${step.status}`}>{mark}</span>
        <span className="flow-step-name">{step.label}</span>
        {(step.branch || step.row !== undefined) && (
          <span className="flow-step-where" title={[step.branch && `Branch ${step.branch}`, step.row !== undefined && `CSV row ${step.row + 1}`].filter(Boolean).join(", ")}>
            {step.branch ? `⑂${step.branch}` : ""}
            {step.branch && step.row !== undefined ? " " : ""}
            {step.row !== undefined ? `row ${step.row + 1}` : ""}
          </span>
        )}
        {step.output && step.output !== "next" && <span className={`flow-step-out out-${step.output}`}>{step.output}</span>}
        <span className="muted mono small">{formatMs(step.durationMs)}</span>
      </button>
      {open && (
        <div className="flow-step-body small">
          {step.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
          {child && (
            <p className="muted">
              {child.passed} of {child.completed} case{child.completed === 1 ? "" : "s"} passed · {child.checksPassed} of {child.checksPassed + child.checksFailed} checks
            </p>
          )}
          {step.attempts && step.attempts.length > 1 && (
            <ol className="flow-attempts">
              {step.attempts.map((a, i) => (
                <li key={i} className={a.passed ? "tone-ok" : "tone-bad"}>
                  Try {i + 1}: {a.passed ? "passed" : "failed"} · {formatMs(a.durationMs)}
                  {a.reason ? ` · ${a.reason}` : ""}
                </li>
              ))}
            </ol>
          )}
          {changes.length > 0 && (
            <div className="flow-var-changes mono">
              {changes.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
          )}
          <button className="link-btn" onClick={onFocus}>
            Show on canvas
          </button>
        </div>
      )}
    </li>
  );
}

/** The right-hand panel when no step is selected: what blocks a run, then live progress or the shown run. */
export function FlowRunPanel({ problems, run, labelFor, onFocusNode, onOpenReport }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!run?.running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [run?.running]);

  const errors = problems.filter((p) => p.level === "error");
  const warnings = problems.filter((p) => p.level === "warning");

  return (
    <aside className="flow-panel" aria-label="Flow run">
      {(errors.length > 0 || warnings.length > 0) && (
        <section className="flow-problems">
          <span className="section-title">{errors.length ? "Fix before running" : "Check"}</span>
          {[...errors, ...warnings].map((p, i) => (
            <button key={i} className={`flow-problem ${p.level} small`} onClick={() => p.nodeId && onFocusNode(p.nodeId)} disabled={!p.nodeId}>
              {p.message}
            </button>
          ))}
        </section>
      )}

      {!run && <p className="muted small">Press Run to start the flow at its Start node. Each step's result shows here and on the canvas.</p>}

      {run?.error && <p className="small flow-problem error">{run.error}</p>}

      {run && !run.error && (
        <section className="flow-run">
          <div className="flow-panel-head">
            <span className="section-title">{run.running ? "Running" : `Last run · ${whenLabel(new Date(run.startedAt).toISOString())}`}</span>
            <span className="muted mono small">{elapsed((run.finishedAt ?? now) - run.startedAt)}</span>
          </div>
          {run.end && (
            <div className={`flow-run-end end-${run.end}`}>
              <strong>{END_LABELS[run.end]}</strong>
              <span className="small">
                {run.passedSteps ?? 0} run step{run.passedSteps === 1 ? "" : "s"} passed, {run.failedSteps ?? 0} failed
              </span>
              {run.endReason && run.end !== "passed" && <span className="small">{run.endReason}</span>}
              {onOpenReport && (
                <button className="link-btn small" onClick={onOpenReport}>
                  Open report
                </button>
              )}
            </div>
          )}
          {run.running && run.runningNodeIds.length > 0 && (
            <p className="small">
              <span className="pulse-dot" aria-hidden /> {[...new Set(run.runningNodeIds)].map(labelFor).join(", ")}
            </p>
          )}
          {run.saveError && <p className="small warning">Could not save this run: {run.saveError}</p>}
          <ol className="flow-steps">
            {[...run.steps].sort((a, b) => a.index - b.index).map((s) => (
              <StepRow key={s.index} step={s} onFocus={() => onFocusNode(s.nodeId)} />
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}
