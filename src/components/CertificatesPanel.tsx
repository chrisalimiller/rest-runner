import { useEffect, useRef } from "react";
import { EXPIRY_WARNING_DAYS, matchCertificate, type CertificateEntry } from "../lib/certificates";
import { openCertificates } from "../lib/certificatesDialog";
import { isTauri } from "../lib/http";
import { useSectionStatus } from "../lib/sectionStatus";
import { closeSidePanel, useSidePanels } from "../lib/sidePanels";
import { ADDING, useCertificates } from "./CertificatesDialog";
import { useEscape } from "./useEscape";
import "./certificates.css";

const DAY_MS = 86_400_000;

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The soonest expiry (Unix seconds) among an entry's client certificate and CA, or null. */
function expiryOf(entry: CertificateEntry): number | null {
  const times = [entry.client?.details.notAfter, entry.ca?.details.notAfter].filter((n): n is number => typeof n === "number");
  return times.length > 0 ? Math.min(...times) : null;
}

/** An amber "expires in N d" pill within 30 days, or "expired". */
function ExpiryPill({ notAfter }: { notAfter: number | null }) {
  if (notAfter === null) return null;
  const ms = notAfter * 1000 - Date.now();
  if (ms < 0) return <span className="cert-badge expired">expired</span>;
  if (ms >= EXPIRY_WARNING_DAYS * DAY_MS) return null;
  return <span className="cert-badge soon">expires in {Math.ceil(ms / DAY_MS)} d</span>;
}

interface Props {
  /** The section on screen; "This request" shows only in Requests. */
  section: string;
  docked: boolean;
}

/** The Certificates side panel: the certificate this request uses, every stored certificate, and the way into the full dialog. */
export function CertificatesPanel({ section, docked }: Props) {
  const { certificates: open } = useSidePanels();
  const entries = useCertificates();
  const { request } = useSectionStatus();
  const ref = useRef<HTMLElement>(null);

  const close = () => {
    if (ref.current?.contains(document.activeElement)) document.querySelector<HTMLElement>("[data-certificates-trigger]")?.focus();
    closeSidePanel("certificates");
  };

  useEscape(close, open && !docked);
  useEffect(() => {
    if (!open || docked) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-certificates-trigger]") && !t.closest(".cert-chip") && !t.closest(".modal-backdrop, .sheet-backdrop, .toast")) closeSidePanel("certificates");
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, docked]);

  if (!open) return null;

  const showRequest = section === "requests" && !!request && request.url !== "";
  const match = showRequest ? matchCertificate(request.url, entries) : null;
  const desktop = isTauri();

  return (
    <aside
      ref={ref}
      id="certificates-panel"
      className={`certs-panel ${docked ? "docked" : "overlay"}`}
      aria-label="Certificates"
      onKeyDown={(e) => {
        if (docked && e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="certs-panel-head">
        <strong>Certificates</strong>
        <button className="icon-btn" onClick={close} aria-label="Close Certificates" title="Close (Esc)">
          ✕
        </button>
      </div>

      <div className="certs-panel-body">
        {showRequest && match && (
          <section className="certs-panel-section">
            <h4 className="section-title">This request</h4>
            {match.insecure ? (
              <p className="muted small">A certificate matches this address, but certificates are only used for https.</p>
            ) : match.client ? (
              <div className="certs-this">
                <button className="certs-this-name" onClick={() => openCertificates(match.client!.id)} title="Open this certificate">
                  {match.client.name || "(unnamed)"}
                </button>
                <div className="muted small">
                  matched <code>{match.clientPattern}</code>
                </div>
                <div className="small">
                  expires <code>{formatDate(match.client.client!.details.notAfter)}</code> <ExpiryPill notAfter={match.client.client!.details.notAfter} />
                </div>
              </div>
            ) : match.cas.length > 0 ? (
              <p className="muted small">No client certificate. Trusts the CA of {match.cas.map((c) => c.name || "(unnamed)").join(", ")}.</p>
            ) : (
              <p className="muted small">No certificate matches this address.</p>
            )}
            {(match.client || request.skipped) && (
              <label className="certs-skip">
                <input type="checkbox" checked={request.skipped} disabled={!request.onSkip} onChange={(e) => request.onSkip?.(e.target.checked)} />
                <span>Send without a certificate</span>
              </label>
            )}
          </section>
        )}

        <section className="certs-panel-section">
          <h4 className="section-title">All certificates</h4>
          {entries.length === 0 ? (
            <p className="muted small">Nothing imported yet.</p>
          ) : (
            <ul className="certs-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <button className="certs-row" onClick={() => openCertificates(e.id)}>
                    <span className="certs-row-name">{e.name || "(unnamed)"}</span>
                    {e.ca && !e.client && <span className="tag">CA</span>}
                    <ExpiryPill notAfter={expiryOf(e)} />
                    <code className="certs-row-pattern">{e.patterns[0] ?? ""}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="certs-panel-foot">
        <button className="secondary" onClick={() => openCertificates()}>
          Manage…
        </button>
        <button className="secondary" disabled={!desktop} onClick={() => openCertificates(ADDING)} title={desktop ? undefined : "Importing certificates needs the desktop app"}>
          + Add certificate or CA
        </button>
      </div>
    </aside>
  );
}
