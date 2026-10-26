import { whenLabel } from "../../lib/earlierSends";
import type { TestRunSummary } from "../../lib/testing/testRun";
import type { TestSuite } from "../../lib/testing/types";

interface Props {
  /** The list is folded to a thin rail; the choice is remembered. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
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

/** Suites and test runs on the left of Testing. Below 800px wide it turns into a select at the top. */
export function TestingSidebar({ collapsed, onToggleCollapsed, suites, activeSuiteId, onOpenSuite, onNewSuite, onExport, onImport, runs, activeRunId, onOpenRun, runningSuiteId }: Props) {
  const importLink = (
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
  );

  return (
    <>
      <div className="runbook-nav-compact">
        <select
          value={activeRunId ? `run:${activeRunId}` : activeSuiteId ? `suite:${activeSuiteId}` : ""}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(":");
            if (kind === "suite") onOpenSuite(id);
            if (kind === "run") onOpenRun(id);
          }}
          aria-label="Suite or test run"
        >
          {!activeSuiteId && !activeRunId && <option value="">Pick a suite…</option>}
          <optgroup label="Suites">
            {suites.map((s) => (
              <option key={s.id} value={`suite:${s.id}`}>
                {s.name || "(unnamed)"} ({s.cases.length})
              </option>
            ))}
          </optgroup>
          {runs.length > 0 && (
            <optgroup label="Test runs">
              {runs.map((r) => (
                <option key={r.id} value={`run:${r.id}`}>
                  {r.suiteName} · {whenLabel(r.startedAt)} · {r.passed} passed{r.failed ? `, ${r.failed} failed` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button className="link-btn small" onClick={onNewSuite}>
          New
        </button>
        {importLink}
      </div>

      {collapsed && (
        <nav className="runbook-nav collapsed" aria-label="Suites and test runs">
          <button className="icon-btn" onClick={onToggleCollapsed} aria-label="Show suites and test runs" title="Show the list" aria-expanded={false}>
            »
          </button>
        </nav>
      )}
      <nav className="runbook-nav" aria-label="Suites and test runs" hidden={collapsed}>
        <div className="nav-group">
          <div className="nav-group-head">
            <span className="section-title">Suites</span>
            <span className="sidebar-actions">
              <button className="link-btn" onClick={onNewSuite} title="Add a test suite">
                New
              </button>
              {importLink}
              <button className="link-btn" onClick={onExport} disabled={suites.length === 0} title="Export all test suites to a file">
                Export
              </button>
              <button className="icon-btn" onClick={onToggleCollapsed} aria-label="Hide the list" title="Hide the list" aria-expanded>
                «
              </button>
            </span>
          </div>
          {suites.length === 0 && <p className="muted small nav-empty">Create a suite, then add cases from saved requests.</p>}
          {suites.map((s) => (
            <button
              key={s.id}
              className={`nav-row ${activeSuiteId === s.id && activeRunId === null ? "active" : ""}`}
              aria-current={activeSuiteId === s.id && activeRunId === null ? "page" : undefined}
              onClick={() => onOpenSuite(s.id)}
              title={s.description || s.name}
            >
              {runningSuiteId === s.id && <span className="pulse-dot" aria-label="Running" />}
              <span className="nav-row-name">{s.name || "(unnamed)"}</span>
              <span className="nav-row-count">{s.cases.length}</span>
            </button>
          ))}
        </div>
        <div className="nav-group">
          <div className="nav-group-head">
            <span className="section-title">Test runs</span>
          </div>
          {runs.length === 0 && <p className="muted small nav-empty">Finished test runs show up here.</p>}
          {runs.map((r) => (
            <button
              key={r.id}
              className={`nav-row run-row ${activeRunId === r.id ? "active" : ""}`}
              onClick={() => onOpenRun(r.id)}
              title={`${r.suiteName}${r.csvName ? `\n${r.csvName}` : ""}`}
            >
              <span className="nav-row-name">{r.suiteName}</span>
              <span className="muted">{whenLabel(r.startedAt)}</span>
              <span className="mono tone-ok">{r.passed}</span>
              {r.failed > 0 && <span className="mono tone-bad">{r.failed}✕</span>}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
