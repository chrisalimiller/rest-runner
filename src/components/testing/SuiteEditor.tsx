import { useState } from "react";
import type { Environment } from "../../lib/environments";
import { duplicateCase, newTestCase } from "../../lib/testing/suites";
import { listPickableRequests } from "../../lib/testing/requestSources";
import type { CaseResult, TestCase, TestSuite } from "../../lib/testing/types";
import { CaseEditor } from "./CaseEditor";
import { LiveRun, type LiveRunState } from "./LiveRun";
import { RequestPicker } from "./RequestPicker";
import { SuiteSettings } from "./SuiteSettings";

/** What the right-hand side shows: a case, the run settings, or the current run. */
export type SuitePanel = { kind: "settings" } | { kind: "case"; id: string } | { kind: "run" };

interface Props {
  suite: TestSuite;
  onChange: (suite: TestSuite) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  panel: SuitePanel;
  onPanel: (p: SuitePanel) => void;
  environments: Environment[];
  envId: string | null;
  onEnvChange: (id: string | null) => void;
  envVarNames: string[];
  live: LiveRunState | null;
  /** True while any suite is running (only one runs at a time). */
  anyRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  onOpenReport: (runId: string) => void;
  onTryCase: (tc: TestCase) => void;
  tryingCaseId: string | null;
  tryResults: Record<string, CaseResult>;
  notice: string | null;
}

export function SuiteEditor(props: Props) {
  const { suite, onChange, panel, onPanel, live } = props;
  const [picking, setPicking] = useState(false);
  const running = live?.suiteId === suite.id && live.running;
  const enabledCount = suite.cases.filter((c) => c.enabled).length;

  const setCases = (cases: TestCase[]) => onChange({ ...suite, cases });
  const updateCase = (tc: TestCase) => setCases(suite.cases.map((c) => (c.id === tc.id ? tc : c)));
  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= suite.cases.length) return;
    const cases = [...suite.cases];
    const [item] = cases.splice(index, 1);
    cases.splice(to, 0, item);
    setCases(cases);
  };
  const addCases = (list: TestCase[]) => {
    if (!list.length) return;
    setCases([...suite.cases, ...list]);
    onPanel({ kind: "case", id: list[0].id });
  };

  const selectedCase = panel.kind === "case" ? suite.cases.find((c) => c.id === panel.id) : undefined;
  const sources = selectedCase?.sourceRequestId ? listPickableRequests().find((r) => r.id === selectedCase.sourceRequestId) : undefined;

  return (
    <main className="workspace suite-workspace">
      <div className="workspace-head">
        <input className="request-name" value={suite.name} onChange={(e) => onChange({ ...suite, name: e.target.value })} aria-label="Suite name" />
        {props.notice && <span className="small notice">{props.notice}</span>}
        <span className="env-picker">
          <select value={props.envId ?? ""} onChange={(e) => props.onEnvChange(e.target.value || null)} aria-label="Environment" title="Environments are edited in the Requests section">
            <option value="">No environment</option>
            {props.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || "(unnamed)"}
              </option>
            ))}
          </select>
          {running ? (
            <button className="send cancel" onClick={props.onStop}>
              Stop
            </button>
          ) : (
            <button
              className="send"
              onClick={props.onRun}
              disabled={enabledCount === 0 || props.anyRunning}
              title={props.anyRunning ? "Another suite is running" : enabledCount === 0 ? "Add or enable a test case first" : "Run every enabled case"}
            >
              Run suite
            </button>
          )}
        </span>
      </div>
      <input
        className="suite-description"
        value={suite.description}
        onChange={(e) => onChange({ ...suite, description: e.target.value })}
        placeholder="Description (optional)"
        aria-label="Suite description"
      />

      <div className="suite-body">
        <div className="case-list">
          <button className={`case-list-item special ${panel.kind === "settings" ? "active" : ""}`} onClick={() => onPanel({ kind: "settings" })}>
            ⚙ Run settings &amp; data
            <span className="muted small">{suite.data ? suite.data.name : "no CSV"}</span>
          </button>
          {live?.suiteId === suite.id && (
            <button className={`case-list-item special ${panel.kind === "run" ? "active" : ""}`} onClick={() => onPanel({ kind: "run" })}>
              {running ? "● Running…" : "▶ Last run"}
              <span className="muted small">
                {live.results.length}/{live.planned}
              </span>
            </button>
          )}
          <div className="sidebar-title case-list-title">
            <span>Cases ({suite.cases.length})</span>
          </div>
          <ol className="cases">
            {suite.cases.map((c, i) => {
              const tried = props.tryResults[c.id];
              return (
                <li key={c.id} className={`${panel.kind === "case" && panel.id === c.id ? "active" : ""} ${c.enabled ? "" : "disabled"}`}>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => updateCase({ ...c, enabled: e.target.checked })} title="Include in runs" aria-label={`Include ${c.name}`} />
                  <button className="case-pick" onClick={() => onPanel({ kind: "case", id: c.id })} title={c.request.url}>
                    <span className="case-num muted">{i + 1}</span>
                    <span className={`method m-${c.request.method.toLowerCase()}`}>{c.request.method}</span>
                    <span className="history-url">{c.name}</span>
                    {tried && <span className={`status ${tried.passed ? "ok" : "bad"}`}>{tried.passed ? "✓" : "✕"}</span>}
                  </button>
                  <span className="case-actions">
                    <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move up">
                      ↑
                    </button>
                    <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === suite.cases.length - 1} title="Move down" aria-label="Move down">
                      ↓
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        const copy = duplicateCase(c);
                        const cases = [...suite.cases];
                        cases.splice(i + 1, 0, copy);
                        setCases(cases);
                        onPanel({ kind: "case", id: copy.id });
                      }}
                      title="Duplicate"
                      aria-label="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        if (!window.confirm(`Delete the test case "${c.name}"?`)) return;
                        setCases(suite.cases.filter((x) => x.id !== c.id));
                        if (panel.kind === "case" && panel.id === c.id) onPanel({ kind: "settings" });
                      }}
                      title="Delete"
                      aria-label="Delete"
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          {suite.cases.length === 0 && <p className="muted small pad">No cases yet. Add saved requests, or start a blank case.</p>}
          <div className="case-add">
            <button className="secondary" onClick={() => setPicking(true)}>
              + From saved requests
            </button>
            <button className="link-btn" onClick={() => addCases([newTestCase()])}>
              + Blank case
            </button>
          </div>
          <div className="case-list-foot">
            <button className="link-btn" onClick={props.onDuplicate}>
              Duplicate suite
            </button>
            <button
              className="link-btn danger-link"
              onClick={() => {
                if (window.confirm(`Delete the suite "${suite.name}" and its ${suite.cases.length} cases? Saved test runs are kept.`)) props.onDelete();
              }}
            >
              Delete suite
            </button>
          </div>
        </div>

        <div className="suite-panel">
          {panel.kind === "settings" && <SuiteSettings suite={suite} onChange={onChange} envVarNames={props.envVarNames} />}
          {panel.kind === "case" && selectedCase && (
            <CaseEditor
              key={selectedCase.id}
              testCase={selectedCase}
              onChange={updateCase}
              onTry={() => props.onTryCase(selectedCase)}
              trying={props.tryingCaseId === selectedCase.id}
              tryResult={props.tryResults[selectedCase.id] ?? null}
              sourceName={sources?.path.join(" › ")}
              onRefreshFromSource={
                sources ? () => updateCase({ ...selectedCase, request: { ...structuredClone(sources.request), id: selectedCase.request.id } }) : undefined
              }
            />
          )}
          {panel.kind === "case" && !selectedCase && <p className="muted pad">This case no longer exists.</p>}
          {panel.kind === "run" && live?.suiteId === suite.id && <LiveRun live={live} onOpenReport={props.onOpenReport} />}
        </div>
      </div>
      {picking && (
        <RequestPicker
          onClose={() => setPicking(false)}
          onPick={(list) => {
            setPicking(false);
            addCases(list.map((r) => newTestCase(r.request)));
          }}
        />
      )}
    </main>
  );
}
