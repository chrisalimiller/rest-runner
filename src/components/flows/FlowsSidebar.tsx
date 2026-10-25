import { whenLabel } from "../../lib/earlierSends";
import type { Flow, FlowRunSummary } from "../../lib/flows/types";

interface Props {
  flows: Flow[];
  activeFlowId: string | null;
  onOpenFlow: (id: string) => void;
  onNewFlow: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  runs: FlowRunSummary[];
  activeRunId: string | null;
  onOpenRun: (id: string) => void;
  runningFlowIds: string[];
  /** Next scheduled run and the latest skipped one, per flow id. */
  scheduleInfo: Record<string, ScheduleInfo>;
}

export interface ScheduleInfo {
  next?: string;
  skipped?: string;
}

const END_MARK = { passed: "✓", failed: "✕", cancelled: "■" } as const;

/** Flows and recent flow runs on the left of Flows mode. Below 800px wide it turns into a select at the top. */
export function FlowsSidebar({ flows, activeFlowId, onOpenFlow, onNewFlow, onExport, onImport, runs, activeRunId, onOpenRun, runningFlowIds, scheduleInfo }: Props) {
  const importLink = (
    <label className="link-btn" title="Import flows from a file">
      Import
      <input
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
    </label>
  );

  return (
    <>
      <div className="runbook-nav-compact">
        <select
          value={activeRunId ? `run:${activeRunId}` : activeFlowId ? `flow:${activeFlowId}` : ""}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(":");
            if (kind === "flow") onOpenFlow(id);
            if (kind === "run") onOpenRun(id);
          }}
          aria-label="Flow or flow run"
        >
          {!activeFlowId && !activeRunId && <option value="">Pick a flow…</option>}
          <optgroup label="Flows">
            {flows.map((f) => (
              <option key={f.id} value={`flow:${f.id}`}>
                {f.name || "(unnamed)"}
              </option>
            ))}
          </optgroup>
          {runs.length > 0 && (
            <optgroup label="Flow runs">
              {runs.map((r) => (
                <option key={r.id} value={`run:${r.id}`}>
                  {r.flowName} · {whenLabel(r.startedAt)} · {r.end}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button className="link-btn small" onClick={onNewFlow}>
          New
        </button>
        {importLink}
      </div>

      <nav className="runbook-nav" aria-label="Flows and flow runs">
        <div className="nav-group">
          <div className="nav-group-head">
            <span className="section-title">Flows</span>
            <span className="sidebar-actions">
              <button className="link-btn" onClick={onNewFlow} title="Add a flow">
                New
              </button>
              {importLink}
              {flows.length > 0 && (
                <button className="link-btn" onClick={onExport} title="Save every flow, with the suites and saved requests they run, to a file">
                  Export
                </button>
              )}
            </span>
          </div>
          {flows.length === 0 && <p className="muted small nav-empty">A flow chains test cases, suites and saved requests into one run.</p>}
          {flows.map((f) => {
            const info = scheduleInfo[f.id];
            return (
              <div key={f.id} className="flow-nav-item">
                <button
                  className={`nav-row ${activeFlowId === f.id && activeRunId === null ? "active" : ""}`}
                  aria-current={activeFlowId === f.id && activeRunId === null ? "page" : undefined}
                  onClick={() => onOpenFlow(f.id)}
                  title={f.description || f.name}
                >
                  {runningFlowIds.includes(f.id) && <span className="pulse-dot" aria-label="Running" />}
                  <span className="nav-row-name">{f.name || "(unnamed)"}</span>
                  <span className="nav-row-count">{f.nodes.filter((n) => n.type !== "note" && n.type !== "start" && n.type !== "schedule").length}</span>
                </button>
                {info?.next && <p className="flow-nav-note muted small">⏱ Next: {info.next}</p>}
                {info?.skipped && <p className="flow-nav-note tone-warn small">{info.skipped}</p>}
              </div>
            );
          })}
        </div>
        <div className="nav-group">
          <div className="nav-group-head">
            <span className="section-title">Flow runs</span>
          </div>
          {runs.length === 0 && <p className="muted small nav-empty">Finished flow runs show up here.</p>}
          {runs.map((r) => (
            <button key={r.id} className={`nav-row run-row ${activeRunId === r.id ? "active" : ""}`} onClick={() => onOpenRun(r.id)} title={r.endReason ?? r.flowName}>
              <span className="nav-row-name">{r.flowName}</span>
              <span className="muted">{whenLabel(r.startedAt)}</span>
              <span className={`mono ${r.end === "passed" ? "tone-ok" : r.end === "failed" ? "tone-bad" : "muted"}`}>{END_MARK[r.end]}</span>
              {r.failedSteps > 0 && <span className="mono tone-bad">{r.failedSteps}✕</span>}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
