import { currentMasker } from "../lib/secrets";
import type { Vars } from "../lib/template";
import type { ScriptOutput } from "../lib/testing/types";

export interface ScriptRun {
  pre?: ScriptOutput;
  post?: ScriptOutput;
}

/** Passed and total rr.test checks across both scripts. */
export function scriptTestCounts(run: ScriptRun | null | undefined): { passed: number; total: number; failed: boolean } {
  const tests = [...(run?.pre?.tests ?? []), ...(run?.post?.tests ?? [])];
  const passed = tests.filter((t) => t.passed).length;
  const failed = passed < tests.length || !!run?.pre?.error || !!run?.post?.error;
  return { passed, total: tests.length, failed };
}

/** Tab label like "Scripts 2/3" or "Scripts". */
export function scriptsTabLabel(run: ScriptRun | null | undefined): string {
  const c = scriptTestCounts(run);
  return c.total ? `Scripts ${c.passed}/${c.total}` : "Scripts";
}

function Block({ title, output }: { title: string; output?: ScriptOutput }) {
  if (!output) return null;
  return (
    <div className="script-result">
      <h4>
        {title} <span className="muted small">({output.durationMs} ms)</span>
      </h4>
      {output.error && (
        <div className="error-box">
          <strong>Script error.</strong>
          <pre>{output.error}</pre>
        </div>
      )}
      {output.tests.length > 0 && (
        <ul className="script-tests">
          {output.tests.map((t, i) => (
            <li key={`${t.name}-${i}`}>
              <span className={`pill ${t.passed ? "ok" : "bad"}`}>{t.passed ? "PASS" : "FAIL"}</span> {t.name}
              {t.error && <span className="muted"> · {t.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {output.logs.length ? <pre className="code-view script-log">{output.logs.join("\n")}</pre> : <p className="muted small">No console output.</p>}
    </div>
  );
}

/** What a request's pre/post scripts did: errors, rr.test results, console output and, optionally, the variables afterwards. */
export function ScriptResults({ run, vars }: { run: ScriptRun; vars?: Vars }) {
  const names = Object.keys(vars ?? {});
  const mask = currentMasker();
  return (
    <div className="script-results">
      <Block title="Pre-request script" output={run.pre} />
      <Block title="Post-response script" output={run.post} />
      {vars && (
        <>
          <h4>Script variables afterwards</h4>
          {names.length ? (
            <table className="kv readonly">
              <tbody>
                {names.map((n) => (
                  <tr key={n}>
                    <td>{n}</td>
                    <td>{mask(vars[n])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">None</p>
          )}
        </>
      )}
    </div>
  );
}
