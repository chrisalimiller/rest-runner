import { currentMasker } from "../lib/secrets";
import { summarizeScripts, testsBadge, type ScriptRunLike } from "../lib/scriptSummary";
import type { Vars } from "../lib/template";

export type ScriptRun = ScriptRunLike;

/** Passed and total rr.test checks across both scripts. */
export function scriptTestCounts(run: ScriptRun | null | undefined): { passed: number; total: number; failed: boolean } {
  const { passed, total, failed } = summarizeScripts(run);
  return { passed, total, failed };
}

/** The Scripts tab's label. The test count is a separate badge: see ScriptsBadge. */
export function scriptsTabLabel(_run?: ScriptRun | null): string {
  return "Scripts";
}

/** "Tests 2/2" next to the tab label, red when something failed. Nothing when no script ran rr.test. */
export function ScriptsBadge({ run }: { run: ScriptRun | null | undefined }) {
  const label = testsBadge(run);
  if (!label) return null;
  return <span className={`tab-badge ${summarizeScripts(run).failed ? "bad" : "ok"}`}>{label}</span>;
}

/**
 * What a request's pre/post scripts did: errors first, then the rr.test results, the variables set,
 * and the console output. Secret values are masked.
 */
export function ScriptResults({ run, vars }: { run: ScriptRun; vars?: Vars }) {
  const s = summarizeScripts(run);
  const mask = currentMasker();
  const shown = vars ?? s.vars;
  const names = Object.keys(shown);
  const ms = (phase: string) => (phase === "Pre-request" ? run.pre : run.post)?.durationMs;
  return (
    <div className="script-results">
      {s.errors.map((e) => (
        <div key={e.phase} className="error-box">
          <strong>{e.phase} script error.</strong>
          <pre>{e.error}</pre>
        </div>
      ))}

      <h4>
        Tests{" "}
        <span className="muted small">
          {s.total ? `${s.passed} of ${s.total} passed` : "none: use rr.test(name, fn) in a script"}
        </span>
      </h4>
      {s.tests.length > 0 && (
        <ul className="script-tests">
          {s.tests.map((t, i) => (
            <li key={`${t.phase}-${t.name}-${i}`}>
              <span className={`pill ${t.passed ? "ok" : "bad"}`}>{t.passed ? "PASS" : "FAIL"}</span> {t.name}
              <span className="muted small"> · {t.phase.toLowerCase()}</span>
              {t.error && <span className="muted"> · {t.error}</span>}
            </li>
          ))}
        </ul>
      )}

      <h4>{vars ? "Script variables afterwards" : "Variables set"}</h4>
      {names.length ? (
        <table className="kv readonly">
          <tbody>
            {names.map((n) => (
              <tr key={n}>
                <td>{n}</td>
                <td>{mask(shown[n])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">None</p>
      )}

      <h4>Console</h4>
      {s.logs.length ? (
        s.logs.map((l) => (
          <div key={l.phase} className="script-result">
            <span className="muted small">
              {l.phase} script{ms(l.phase) !== undefined ? ` (${ms(l.phase)} ms)` : ""}
            </span>
            <pre className="code-view script-log">{mask(l.lines.join("\n"))}</pre>
          </div>
        ))
      ) : (
        <p className="muted small">No console output.</p>
      )}
    </div>
  );
}
