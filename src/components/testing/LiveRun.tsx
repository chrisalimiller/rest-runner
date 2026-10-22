import { useEffect, useState } from "react";
import type { CaseResult, SuiteRunEnd } from "../../lib/testing/types";
import { CaseResultView } from "./CaseResultView";
import { ResultRow } from "./ResultRow";

export interface LiveRunState {
  suiteId: string;
  running: boolean;
  planned: number;
  results: CaseResult[];
  startedAt: number;
  finishedAt?: number;
  end?: SuiteRunEnd;
  /** Set once the run is saved. */
  runId?: string;
  saveError?: string;
}

const SHOWN = 300;

function elapsed(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

/** Progress and results of the run in progress (or the one that just finished). */
export function LiveRun({ live, onOpenReport }: { live: LiveRunState; onOpenReport: (runId: string) => void }) {
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (!live.running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live.running]);

  const done = live.results.length;
  const failed = live.results.filter((r) => !r.passed).length;
  const pct = live.planned ? Math.min(100, Math.round((done / live.planned) * 100)) : 0;
  const recent = live.results.slice(-SHOWN).reverse();
  const picked = selected !== null ? live.results[selected] : null;

  return (
    <div className="live-run">
      <div className="progress-bar">
        <div className={`progress-fill ${failed ? "has-failures" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-stats small">
        <span>
          {done} / {live.planned} cases
        </span>
        <span className="status ok">{done - failed} passed</span>
        <span className={failed ? "status bad" : "muted"}>{failed} failed</span>
        <span className="muted">{elapsed((live.finishedAt ?? now) - live.startedAt)}</span>
        {!live.running && live.end && (
          <span>{live.end === "cancelled" ? "Stopped" : live.end === "stopped-on-failure" ? "Stopped after a failure" : "Finished"}</span>
        )}
        {live.runId && (
          <button className="link-btn" onClick={() => onOpenReport(live.runId!)}>
            Open report →
          </button>
        )}
        {live.saveError && <span className="warning">Could not save the run: {live.saveError}</span>}
      </div>
      <div className="live-body">
        <div className="results-scroll">
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
              {recent.map((r) => {
                const index = live.results.indexOf(r);
                return <ResultRow key={index} result={r} selected={selected === index} onSelect={() => setSelected(index)} />;
              })}
            </tbody>
          </table>
          {done === 0 && <p className="muted small pad">{live.running ? "Waiting for the first case…" : "No cases ran."}</p>}
          {done > SHOWN && <p className="muted small pad">Showing the latest {SHOWN}. The report has every case.</p>}
        </div>
        <div className="result-detail">{picked ? <CaseResultView key={selected} result={picked} /> : <p className="muted small pad">Select a case to see its details.</p>}</div>
      </div>
    </div>
  );
}
