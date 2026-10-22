import { useEffect, useRef, useState } from "react";
import { formatMs, statusTone } from "../lib/earlierSends";
import { formatBytes } from "../lib/format";
import { BodyView } from "./BodyView";
import { AlertIcon, PlayIcon } from "./shell/Icons";
import { MOD_KEY } from "./shell/TopBar";
import type { SendOutcome } from "../lib/types";

interface Props {
  outcome: SendOutcome | null;
  sending: boolean;
  /** The outcome is a saved sample (an example's response or an earlier send), not a live call. */
  isSample?: boolean;
  /** Chip text for a sample; defaults to "Sample response". */
  sampleLabel?: string;
  /** One line of advice under an error, e.g. which environment was used. */
  errorHint?: string;
}

type Tab = "body" | "headers" | "request";

function timeOfDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Status hero, Body / Headers / Sent request switch, and the body. Also draws the empty, sending and error states. */
export function ResponsePane({ outcome, sending, isSample = false, sampleLabel, errorHint }: Props) {
  const [chosenTab, setTab] = useState<Tab>("body");
  const [pretty, setPretty] = useState(true);
  const [now, setNow] = useState(Date.now());
  const startRef = useRef(0);

  useEffect(() => {
    if (!sending) return;
    startRef.current = Date.now();
    setNow(startRef.current);
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [sending]);

  if (sending) {
    return (
      <section className="response state">
        <div className="indeterminate" aria-hidden>
          <span />
        </div>
        <p>
          Sending request… <span className="mono muted">{formatMs(now - startRef.current)}</span>
        </p>
      </section>
    );
  }

  if (!outcome) {
    return (
      <section className="response state">
        <PlayIcon size={28} className="state-icon" />
        <p className="state-title">No response yet</p>
        <p className="muted small">Press Send or {MOD_KEY} + Enter to see the response here.</p>
      </section>
    );
  }

  const res = outcome.ok ? outcome.response : null;
  const tab: Tab = (isSample && chosenTab === "request") || (!res && chosenTab === "headers") ? "body" : chosenTab;
  const tone = statusTone(res ? res.status : null);

  return (
    <section className="response">
      <div className="response-top">
        <div className="status-hero">
          <span className={`hero-code tone-${tone}`}>{res ? res.status : "ERR"}</span>
          <span className="hero-text">{res ? res.statusText || "" : "No response"}</span>
          <span className="hero-gap" />
          {isSample ? (
            <span className="chip example-chip">{sampleLabel ?? "Sample response"}</span>
          ) : (
            <span className="hero-meta">
              <span className="mono">{outcome.ok ? outcome.response.durationMs : outcome.durationMs}</span> ms
            </span>
          )}
          {res && (
            <span className="hero-meta">
              <span className="mono">{formatBytes(res.sizeBytes).replace(/ [KM]?B$/, "")}</span> {formatBytes(res.sizeBytes).replace(/^[\d.]+ /, "")}
            </span>
          )}
          {!isSample && outcome.sentAt && <span className="hero-meta">{timeOfDay(outcome.sentAt)}</span>}
        </div>
        <div className="response-tools">
          <div className="segmented" role="tablist" aria-label="Response parts">
            <button role="tab" aria-selected={tab === "body"} className={tab === "body" ? "on" : ""} onClick={() => setTab("body")}>
              Body
            </button>
            <button role="tab" aria-selected={tab === "headers"} className={tab === "headers" ? "on" : ""} onClick={() => setTab("headers")} disabled={!res}>
              Headers{res ? ` ${res.headers.length}` : ""}
            </button>
            {!isSample && (
              <button role="tab" aria-selected={tab === "request"} className={tab === "request" ? "on" : ""} onClick={() => setTab("request")}>
                Sent request
              </button>
            )}
          </div>
          <span className="hero-gap" />
          {tab === "body" && res && (
            <>
              <button className="link-btn muted-link small" onClick={() => setPretty((p) => !p)} aria-pressed={!pretty} title={pretty ? "Show the body as received" : "Pretty-print JSON"}>
                {pretty ? "Raw" : "Pretty"}
              </button>
              <button className="link-btn small" onClick={() => navigator.clipboard?.writeText(res.body)}>
                Copy
              </button>
            </>
          )}
        </div>
      </div>

      <div className="response-body">
        {tab === "body" &&
          (res ? (
            <BodyView body={res.body} pretty={pretty} />
          ) : (
            <div className="error-box">
              <div className="error-title">
                <AlertIcon />
                <strong>Could not get a response.</strong>
              </div>
              <pre>{outcome.ok ? "" : outcome.error}</pre>
              <p className="small">{errorHint ?? "Check that the server is reachable from this computer, or switch environments."}</p>
            </div>
          ))}

        {tab === "headers" && res && (
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
        )}

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
