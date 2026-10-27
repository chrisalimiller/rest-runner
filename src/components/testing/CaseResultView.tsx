import { currentMasker } from "../../lib/secrets";
import { useState } from "react";
import { formatBytes, statusClass } from "../../lib/format";
import type { CaseResult, ScriptOutput } from "../../lib/testing/types";
import { BodyView } from "../BodyView";

export type Tab = "checks" | "request" | "response" | "headers" | "scripts" | "vars";

function PairTable({ rows }: { rows: [string, string][] }) {
  if (!rows.length) return <p className="muted small">None</p>;
  return (
    <table className="kv readonly">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`}>
            <td>{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScriptBlock({ title, output }: { title: string; output?: ScriptOutput }) {
  if (!output) return null;
  return (
    <>
      <h4>
        {title} <span className="muted small">({output.durationMs} ms)</span>
      </h4>
      {output.error && (
        <div className="error-box">
          <strong>Script error.</strong>
          <pre>{output.error}</pre>
        </div>
      )}
      {output.logs.length ? <pre className="code-view script-log">{output.logs.join("\n")}</pre> : <p className="muted small">No console output.</p>}
    </>
  );
}

/** Everything about one test case result: checks, notes, request, response, script output and variables. */
export function CaseResultView({ result, title, initialTab = "checks" }: { result: CaseResult; title?: string; initialTab?: Tab }) {
  const mask = currentMasker();
  const [tab, setTab] = useState<Tab>(initialTab);
  const o = result.outcome;
  const res = o?.ok ? o.response : null;
  const failedChecks = result.checks.filter((c) => !c.passed).length;
  const hasScripts = !!(result.preScript || result.postScript);
  const logCount = (result.preScript?.logs.length ?? 0) + (result.postScript?.logs.length ?? 0);

  return (
    <div className="call-detail">
      <div className="call-detail-head">
        <strong>{title ?? result.caseName}</strong>
        {res ? (
          <span className={`status ${statusClass(res.status)}`}>
            {res.status} {res.statusText}
          </span>
        ) : (
          <span className="status bad">{o ? "No response" : "Not sent"}</span>
        )}
        {o && <span className="muted">{o.ok ? o.response.durationMs : o.durationMs} ms</span>}
        {res && <span className="muted">{formatBytes(res.sizeBytes)}</span>}
        <span className={`pill ${result.passed ? "ok" : "bad"}`}>{result.passed ? "PASS" : "FAIL"}</span>
      </div>
      <div className="tabs">
        <button className={tab === "checks" ? "active" : ""} onClick={() => setTab("checks")}>
          Checks ({result.checks.length - failedChecks}/{result.checks.length})
        </button>
        <button className={tab === "request" ? "active" : ""} onClick={() => setTab("request")} disabled={!o}>
          Request
        </button>
        <button className={tab === "response" ? "active" : ""} onClick={() => setTab("response")} disabled={!o}>
          Response
        </button>
        <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")} disabled={!res}>
          Headers{res ? ` (${res.headers.length})` : ""}
        </button>
        <button className={tab === "scripts" ? "active" : ""} onClick={() => setTab("scripts")} disabled={!hasScripts}>
          Scripts{logCount ? ` (${logCount})` : ""}
        </button>
        <button className={tab === "vars" ? "active" : ""} onClick={() => setTab("vars")}>
          Variables
        </button>
      </div>
      <div className="call-detail-body">
        {tab === "checks" && (
          <>
            {result.checks.length ? (
              <ul className="checks">
                {result.checks.map((c, i) => (
                  <li key={i} className={c.passed ? "ok" : "bad"}>
                    <span className="check-mark">{c.passed ? "✓" : "✕"}</span>
                    <span className="check-name">{c.name}</span>
                    <span className="check-source muted small">{c.source === "assertion" ? "assertion" : c.source === "status" ? "status" : c.source}</span>
                    {c.message && <span className="check-message small">{c.message}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No checks ran.</p>
            )}
            <h4>Notes</h4>
            {result.notes.length ? (
              <ul className="notes">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing unusual.</p>
            )}
            <h4>Timing</h4>
            <p className="small">
              Started {new Date(result.startedAt).toLocaleString()} · case took {result.durationMs} ms including scripts
            </p>
          </>
        )}
        {tab === "request" && o && (
          <>
            <p className="mono">
              <strong>{o.request.method}</strong> {mask(o.request.url)}
            </p>
            <h4>Headers</h4>
            <PairTable rows={o.request.headers.map(([k, v]) => [k, mask(v)])} />
            <h4>Body</h4>
            {o.request.body ? <BodyView body={mask(o.request.body)} /> : <p className="muted small">No body</p>}
          </>
        )}
        {tab === "response" &&
          o &&
          (res ? (
            <BodyView body={mask(res.body)} />
          ) : (
            <div className="error-box">
              <strong>No response.</strong>
              <pre>{o.ok ? "" : o.error}</pre>
            </div>
          ))}
        {tab === "headers" && res && <PairTable rows={res.headers} />}
        {tab === "scripts" && (
          <>
            <ScriptBlock title="Pre-request script" output={result.preScript} />
            <ScriptBlock title="Post-response script" output={result.postScript} />
          </>
        )}
        {tab === "vars" && (
          <>
            <p className="muted small">Values the request was filled from: environment, then CSV row, then variables set by scripts.</p>
            <PairTable rows={Object.entries(result.vars)} />
            {result.postScript && (
              <>
                <h4>After the post-response script</h4>
                <PairTable rows={Object.entries(result.postScript.vars)} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
