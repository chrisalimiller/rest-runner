import { useState } from "react";
import { formatBytes, statusClass } from "../lib/format";
import { BodyView } from "./BodyView";
import type { RunEntry } from "../lib/run";

type Tab = "overview" | "request" | "response" | "headers";

function HeaderTable({ headers }: { headers: [string, string][] }) {
  if (!headers.length) return <p className="muted small">None</p>;
  return (
    <table className="kv readonly">
      <tbody>
        {headers.map(([k, v], i) => (
          <tr key={`${k}-${i}`}>
            <td>{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Everything about one call in a saved run: notes, CSV values, the request, and the response. */
export function CallDetail({ entry }: { entry: RunEntry }) {
  const [tab, setTab] = useState<Tab>("overview");
  const o = entry.outcome;
  const res = o.ok ? o.response : null;

  return (
    <div className="call-detail">
      <div className="call-detail-head">
        <strong>Row {entry.index + 1}</strong>
        {res ? (
          <span className={`status ${statusClass(res.status)}`}>
            {res.status} {res.statusText}
          </span>
        ) : (
          <span className="status bad">No response</span>
        )}
        <span className="muted">{res ? res.durationMs : o.ok ? 0 : o.durationMs} ms</span>
        {res && <span className="muted">{formatBytes(res.sizeBytes)}</span>}
        <span className={`pill ${entry.failed ? "bad" : "ok"}`}>{entry.failed ? "FAIL" : "PASS"}</span>
      </div>
      <div className="tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          Notes &amp; values{entry.notes.length ? ` (${entry.notes.length})` : ""}
        </button>
        <button className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>
          Request
        </button>
        <button className={tab === "response" ? "active" : ""} onClick={() => setTab("response")}>
          Response
        </button>
        <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
          Response headers{res ? ` (${res.headers.length})` : ""}
        </button>
      </div>
      <div className="call-detail-body">
        {tab === "overview" && (
          <>
            <h4>Notes</h4>
            {entry.notes.length ? (
              <ul className="notes">
                {entry.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing unusual.</p>
            )}
            <h4>CSV values</h4>
            <HeaderTable headers={Object.entries(entry.vars)} />
            <h4>Timing</h4>
            <p className="small">
              Sent {new Date(o.sentAt).toLocaleString()} · took {res ? res.durationMs : o.ok ? 0 : o.durationMs} ms
            </p>
          </>
        )}
        {tab === "request" && (
          <>
            <p className="mono">
              <strong>{o.request.method}</strong> {o.request.url}
            </p>
            <h4>Headers</h4>
            <HeaderTable headers={o.request.headers} />
            <h4>Body</h4>
            {o.request.body ? <BodyView body={o.request.body} /> : <p className="muted small">No body</p>}
          </>
        )}
        {tab === "response" &&
          (res ? (
            <BodyView body={res.body} />
          ) : (
            <div className="error-box">
              <strong>No response.</strong>
              <pre>{o.ok ? "" : o.error}</pre>
            </div>
          ))}
        {tab === "headers" && (res ? <HeaderTable headers={res.headers} /> : <p className="muted small">No response.</p>)}
      </div>
    </div>
  );
}
