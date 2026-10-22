import type { TestRunSummary } from "../../lib/testing/testRun";
import type { TestSuite } from "../../lib/testing/types";

interface Props {
  suites: TestSuite[];
  activeSuiteId: string | null;
  onOpenSuite: (id: string) => void;
  onNewSuite: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  runs: TestRunSummary[];
  activeRunId: string | null;
  onOpenRun: (id: string) => void;
  runningSuiteId: string | null;
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

export function TestingSidebar({ suites, activeSuiteId, onOpenSuite, onNewSuite, onExport, onImport, runs, activeRunId, onOpenRun, runningSuiteId }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">REST Runner</div>
      <button className="primary-outline" onClick={onNewSuite}>
        + New test suite
      </button>
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>Test suites</span>
          <span className="sidebar-actions">
            <label className="link-btn" title="Import test suites from a file">
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
            <button className="link-btn" onClick={onExport} disabled={suites.length === 0} title="Export all test suites to a file">
              Export
            </button>
          </span>
        </div>
        {suites.length === 0 && <p className="muted small">A suite is an ordered list of test cases you run together.</p>}
        <ul className="history saved">
          {suites.map((s) => (
            <li key={s.id}>
              <button className={activeSuiteId === s.id && activeRunId === null ? "active" : ""} onClick={() => onOpenSuite(s.id)} title={s.description || s.name}>
                <span className="suite-icon">{runningSuiteId === s.id ? "●" : "▤"}</span>
                <span className="history-url">{s.name || "(unnamed)"}</span>
                <span className="muted small">{s.cases.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>Test runs</span>
        </div>
        {runs.length === 0 && <p className="muted small">Finished test runs show up here.</p>}
        <ul className="history runs">
          {runs.map((r) => (
            <li key={r.id}>
              <button className={activeRunId === r.id ? "active" : ""} onClick={() => onOpenRun(r.id)} title={`${r.suiteName}${r.csvName ? `\n${r.csvName}` : ""}`}>
                <span className="run-name">{r.suiteName}</span>
                <span className="run-meta">
                  <span className="muted">{when(r.startedAt)}</span>
                  <span className="status ok">{r.passed}</span>
                  {r.failed > 0 && <span className="status bad">{r.failed}✕</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
