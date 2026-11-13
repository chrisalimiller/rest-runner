import { currentMasker } from "../lib/secrets";
import { useEffect, useRef, useState } from "react";
import { formatMs, statusTone } from "../lib/earlierSends";
import { prettyBody, splitBytes } from "../lib/format";
import { CANCELLED } from "../lib/http";
import { BodyView } from "./BodyView";
import { ScriptResults, ScriptsBadge, scriptsTabLabel, scriptTestCounts, type ScriptRun } from "./ScriptResults";
import { AlertIcon, CopyIcon, LockIcon, PlayIcon } from "./shell/Icons";
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
  /** The earlier-sends picker, shown at the end of the status field. */
  earlier?: React.ReactNode;
}

type Tab = "body" | "headers" | "request" | "scripts";

function timeOfDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The 60px band at the top of the response: one 40px field, built like the URL bar beside it. */
function Band({ children, viewing = false }: { children: React.ReactNode; viewing?: boolean }) {
  return (
    <div className="resp-band">
      <div className={`status-field ${viewing ? "viewing" : ""}`}>{children}</div>
    </div>
  );
}

/** The tab row used while there is no response to look at: Body only, the rest dimmed. */
function IdleTabs() {
  return (
    <div className="req-tabs resp-tabs">
      <div className="tabs" role="tablist" aria-label="Response parts">
        <button role="tab" aria-selected className="active" tabIndex={0}>
          Body
        </button>
        <button role="tab" aria-selected={false} disabled>
          Headers
        </button>
        <button role="tab" aria-selected={false} disabled>
          Sent request
        </button>
      </div>
    </div>
  );
}

/** Status band, Body / Headers / Sent request / Scripts tabs, and the body. Also draws the empty and sending states. */
export function ResponsePane({ outcome, sending, isSample = false, sampleLabel, errorHint, scripts, scriptVars, bodyNote, earlier }: Props) {
  const [chosenTab, setTab] = useState<Tab>("body");
  const [pretty, setPretty] = useState(true);
  const [beautify, setBeautify] = useState(false);
  const [now, setNow] = useState(Date.now());
  const startRef = useRef(0);
  // Counts distinct responses (by outcome identity), so the arrival cue replays per send but not on tab switches or other re-renders.
  const arrivalRef = useRef<{ outcome: SendOutcome | null; n: number }>({ outcome: null, n: 0 });
  if (outcome && arrivalRef.current.outcome !== outcome) arrivalRef.current = { outcome, n: arrivalRef.current.n + 1 };
  const arrival = arrivalRef.current.n % 2 ? "a" : "b";

  useEffect(() => {
    if (!sending) return;
    startRef.current = Date.now();
    setNow(startRef.current);
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [sending]);

  if (sending) {
    return (
      <section className="response">
        <Band>
          <span className="field-main">
            <span className="field-note">
              <span className="pulse-dot" aria-hidden /> Sending request… <span className="mono muted">{formatMs(now - startRef.current)}</span>
            </span>
          </span>
          {earlier}
        </Band>
        <IdleTabs />
        <div className="response-body state">
          <div className="indeterminate" aria-hidden>
            <span />
          </div>
        </div>
      </section>
    );
  }

  if (!outcome) {
    return (
      <section className="response">
        <Band>
          <span className="field-main">
            <span className="field-note muted">No response yet</span>
          </span>
          {earlier}
        </Band>
        <IdleTabs />
        <div className="response-body state">
          <PlayIcon size={28} className="state-icon" />
          <p className="state-title">No response yet</p>
          <p className="muted small">Press Send or {MOD_KEY} + Enter to see the response here.</p>
        </div>
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
  // Only the raw view needs it (Pretty parses the body itself); skipped otherwise so big bodies are not parsed twice.
  const body = res && !pretty ? prettyBody(res.body) : { isJson: false, text: "" };
  const contentType = res?.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1].split(";")[0].trim() || "No content type";
  const showBodyTools = tab === "body" && !!res && !bodyNote;

  return (
    <section className="response">
      <Band viewing={isSample && !cancelled}>
        <span className="field-main">
          <span className={`status-tile tint-${tone}`} data-arrive={arrival}>
            <span className={`hero-code tone-${tone}`}>{res ? res.status : "ERR"}</span>
            <span className="hero-text">{res ? res.statusText || "" : cancelled ? "Cancelled" : "No response"}</span>
          </span>
          {cancelled ? null : (
            <span className="hero-meta">
              {outcome.ok ? outcome.response.durationMs : outcome.durationMs} <span className="unit">ms</span>
            </span>
          )}
          {res && !bodyNote && (
            <span className="hero-meta">
              {splitBytes(res.sizeBytes).value} <span className="unit">{splitBytes(res.sizeBytes).unit}</span>
            </span>
          )}
          {!isSample && outcome.certificate && (
            <span className="hero-meta" title={`Sent with the certificate "${outcome.certificate.name}"`}>
              <LockIcon size={11} /> {outcome.certificate.name}
            </span>
          )}
          {!isSample && outcome.sentAt && <span className="hero-meta">{timeOfDay(outcome.sentAt)}</span>}
          {isSample && !cancelled && <span className="viewing-tag">{sampleLabel ?? "Sample response"}</span>}
        </span>
        {earlier}
      </Band>

      <div className="req-tabs resp-tabs">
        <div className="tabs" role="tablist" aria-label="Response parts">
          <button role="tab" aria-selected={tab === "body"} className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>
            Body
          </button>
          <button role="tab" aria-selected={tab === "headers"} className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")} disabled={!res || !!bodyNote}>
            Headers
            {res && <span className="req-details-mark">{res.headers.length}</span>}
          </button>
          {!isSample && (
            <button role="tab" aria-selected={tab === "request"} className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>
              {notSent ? "Request" : "Sent request"}
            </button>
          )}
          {hasScripts && (
            <button
              role="tab"
              aria-selected={tab === "scripts"}
              className={`${tab === "scripts" ? "active" : ""} ${scriptTestCounts(scripts).failed ? "has-failures" : ""}`}
              onClick={() => setTab("scripts")}
              title="Pre-request and post-response script output"
            >
              {scriptsTabLabel(scripts)}
              <ScriptsBadge run={scripts} />
            </button>
          )}
        </div>
        {showBodyTools && (
          <div className="req-tabs-end">
            <span className="block-head-type" title="Content-Type">
              {contentType}
            </span>
            <div className="segmented small" role="group" aria-label="Body view">
              <button className={pretty ? "on" : ""} aria-pressed={pretty} onClick={() => setPretty(true)} title="Pretty-print JSON">
                Pretty
              </button>
              <button className={!pretty ? "on" : ""} aria-pressed={!pretty} onClick={() => setPretty(false)} title="Show the body as received">
                Raw
              </button>
            </div>
            {!pretty && body.isJson && (
              <button className={`link-btn small ${beautify ? "on" : ""}`} aria-pressed={beautify} onClick={() => setBeautify((b) => !b)} title="Indent the JSON; the raw text is still plain and selectable">
                {beautify ? "Beautified" : "Beautify"}
              </button>
            )}
            <button className="block-icon-btn" onClick={() => navigator.clipboard?.writeText(!pretty && beautify && body.isJson ? body.text : res.body)} aria-label="Copy response body" title="Copy response body">
              <CopyIcon />
            </button>
          </div>
        )}
      </div>

      <div className="response-body" data-arrive={tab === "body" && (res?.body.length ?? 0) <= 200_000 ? arrival : undefined}>
        {tab === "body" &&
          (res && bodyNote ? (
            <p className="muted small body-note">{bodyNote}</p>
          ) : res ? (
            <BodyView body={res.body} pretty={pretty} beautify={beautify} lineNumbers />
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
