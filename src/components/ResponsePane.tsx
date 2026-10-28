import { currentMasker } from "../lib/secrets";
import { useEffect, useRef, useState } from "react";
import { formatMs, statusTone } from "../lib/earlierSends";
import { formatBytes } from "../lib/format";
import { CANCELLED } from "../lib/http";
import { BodyView } from "./BodyView";
import { ScriptResults, ScriptsBadge, scriptsTabLabel, scriptTestCounts, type ScriptRun } from "./ScriptResults";
import { AlertIcon, LockIcon, PlayIcon } from "./shell/Icons";
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
  /** What the request's pre/post scripts did on this send, if it has any. */
  scripts?: ScriptRun | null;
  /** Script variables after the send, shown with the script results (batch rows). */
  scriptVars?: Record<string, string>;
  /** Shown in place of the body when the sample kept no body, e.g. an older history entry. */
  bodyNote?: string;
}

type Tab = "body" | "headers" | "request" | "scripts";

function timeOfDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Status hero, Body / Headers / Sent request switch, and the body. Also draws the empty, sending and error states. */
export function ResponsePane({ outcome, sending, isSample = false, sampleLabel, errorHint, scripts, scriptVars, bodyNote }: Props) {
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
  const hasScripts = !!(scripts && (scripts.pre || scripts.post));
  const notSent = !!scripts?.pre?.error && !res;
  const cancelled = !outcome.ok && outcome.error === CANCELLED;
  const tab: Tab =
    (isSample && chosenTab === "request") || ((!res || bodyNote) && chosenTab === "headers") || (!hasScripts && chosenTab === "scripts") ? "body" : chosenTab;
  const tone = statusTone(res ? res.status : null);
  const mask = currentMasker();

  return (
    <section className="response">
      <div className="response-top">
        <div className="status-hero">
          <span className={`hero-code tone-${tone}`}>{res ? res.status : "ERR"}</span>
          <span className="hero-text">{res ? res.statusText || "" : cancelled ? "Cancelled" : "No response"}</span>
          <span className="hero-gap" />
          {cancelled ? null : isSample ? (
            <span className="chip example-chip">{sampleLabel ?? "Sample response"}</span>
          ) : (
            <span className="hero-meta">
              <span className="mono">{outcome.ok ? outcome.response.durationMs : outcome.durationMs}</span> ms
            </span>
          )}
          {res && !bodyNote && (
            <span className="hero-meta">
              <span className="mono">{formatBytes(res.sizeBytes).replace(/ [KM]?B$/, "")}</span> {formatBytes(res.sizeBytes).replace(/^[\d.]+ /, "")}
            </span>
          )}
          {!isSample && outcome.certificate && (
            <span className="hero-meta" title={`Sent with the certificate "${outcome.certificate.name}"`}>
              <LockIcon size={11} /> {outcome.certificate.name}
            </span>
          )}
          {!isSample && outcome.sentAt && <span className="hero-meta">{timeOfDay(outcome.sentAt)}</span>}
        </div>
        <div className="response-tools">
          <div className="segmented" role="tablist" aria-label="Response parts">
            <button role="tab" aria-selected={tab === "body"} className={tab === "body" ? "on" : ""} onClick={() => setTab("body")}>
              Body
            </button>
            <button role="tab" aria-selected={tab === "headers"} className={tab === "headers" ? "on" : ""} onClick={() => setTab("headers")} disabled={!res || !!bodyNote}>
              Headers{res ? ` ${res.headers.length}` : ""}
            </button>
            {!isSample && (
              <button role="tab" aria-selected={tab === "request"} className={tab === "request" ? "on" : ""} onClick={() => setTab("request")}>
                {notSent ? "Request" : "Sent request"}
              </button>
            )}
            {hasScripts && (
              <button
                role="tab"
                aria-selected={tab === "scripts"}
                className={`${tab === "scripts" ? "on" : ""} ${scriptTestCounts(scripts).failed ? "has-failures" : ""}`}
                onClick={() => setTab("scripts")}
                title="Pre-request and post-response script output"
              >
                {scriptsTabLabel(scripts)}
                <ScriptsBadge run={scripts} />
              </button>
            )}
          </div>
          <span className="hero-gap" />
          {tab === "body" && res && !bodyNote && (
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
          (res && bodyNote ? (
            <p className="muted small body-note">{bodyNote}</p>
          ) : res ? (
            <BodyView body={res.body} pretty={pretty} />
          ) : (
            <div className="error-box">
              <div className="error-title">
                <AlertIcon />
                <strong>{notSent ? "The request was not sent." : cancelled ? "You cancelled this request." : "Could not get a response."}</strong>
              </div>
              {!cancelled && <pre>{outcome.ok ? "" : outcome.error}</pre>}
              {cancelled ? (
                <p className="small">It was stopped before a response came back. Send it again when you are ready.</p>
              ) : notSent ? (
                <p className="small">
                  Fix the pre-request script and send again.{" "}
                  <button className="link-btn small" onClick={() => setTab("scripts")}>
                    See script output
                  </button>
                </p>
              ) : (
                <p className="small">{errorHint ?? "Check that the server is reachable from this computer, or switch environments."}</p>
              )}
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

        {tab === "scripts" && scripts && <ScriptResults run={scripts} vars={scriptVars} />}

        {tab === "request" && (
          <pre className="code-view">
            {mask(`${outcome.request.method} ${outcome.request.url}\n`)}
            {mask(outcome.request.headers.map(([k, v]) => `${k}: ${v}\n`).join(""))}
            {outcome.request.body ? `\n${mask(outcome.request.body)}` : ""}
          </pre>
        )}
      </div>
    </section>
  );
}
