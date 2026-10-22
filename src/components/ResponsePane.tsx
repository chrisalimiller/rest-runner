import { useState } from "react";
import { formatBytes, statusClass } from "../lib/format";
import { BodyView } from "./BodyView";
import type { SendOutcome } from "../lib/types";

interface Props {
  outcome: SendOutcome | null;
  sending: boolean;
}

type Tab = "body" | "headers" | "request";

export function ResponsePane({ outcome, sending }: Props) {
  const [tab, setTab] = useState<Tab>("body");
  const [pretty, setPretty] = useState(true);

  if (sending) {
    return (
      <section className="response empty">
        <p className="muted">Sending request…</p>
      </section>
    );
  }

  if (!outcome) {
    return (
      <section className="response empty">
        <p className="muted">Enter a URL and click Send to get a response.</p>
      </section>
    );
  }

  const res = outcome.ok ? outcome.response : null;

  return (
    <section className="response">
      <div className="response-header">
        <div className="tabs">
          <button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>
            Body
          </button>
          <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
            Headers{res ? ` (${res.headers.length})` : ""}
          </button>
          <button className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>
            Sent request
          </button>
        </div>
        <div className="response-meta">
          {res ? (
            <>
              <span className={`status ${statusClass(res.status)}`}>
                {res.status} {res.statusText}
              </span>
              <span>{res.durationMs} ms</span>
              <span>{formatBytes(res.sizeBytes)}</span>
            </>
          ) : (
            <span className="status bad">Error · {outcome.ok ? 0 : outcome.durationMs} ms</span>
          )}
        </div>
      </div>

      <div className="response-body">
        {tab === "body" &&
          (res ? (
            <>
              <div className="body-toolbar">
                <label className="radio">
                  <input type="radio" checked={pretty} onChange={() => setPretty(true)} /> Pretty
                </label>
                <label className="radio">
                  <input type="radio" checked={!pretty} onChange={() => setPretty(false)} /> Raw
                </label>
                <button className="link-btn" onClick={() => navigator.clipboard?.writeText(res.body)}>
                  Copy
                </button>
              </div>
              <BodyView body={res.body} pretty={pretty} />
            </>
          ) : (
            <div className="error-box">
              <strong>Could not get a response.</strong>
              <pre>{outcome.ok ? "" : outcome.error}</pre>
            </div>
          ))}

        {tab === "headers" &&
          (res ? (
            <table className="kv readonly">
              <tbody>
                {res.headers.map(([k, v], i) => (
                  <tr key={`${k}-${i}`}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No response headers.</p>
          ))}

        {tab === "request" && (
          <pre className="code-view">
            {`${outcome.request.method} ${outcome.request.url}\n`}
            {outcome.request.headers.map(([k, v]) => `${k}: ${v}\n`).join("")}
            {outcome.request.body ? `\n${outcome.request.body}` : ""}
          </pre>
        )}
      </div>
    </section>
  );
}
