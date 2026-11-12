import { useRef } from "react";
import { useCertificates } from "../CertificatesDialog";
import { MODES, nextModeIndex } from "../../lib/topBar";
import { CERT_WARNING_DAYS, railBadge, useSectionStatus, type RailBadge, type RailItem, type StatusSection } from "../../lib/sectionStatus";
import { toggleSidePanel, useSidePanels } from "../../lib/sidePanels";
import { FlowsIcon, LockIcon, RequestsIcon, TestingIcon, ToolsIcon } from "./Icons";
import { MOD_KEY, MODE_LABELS, type Mode } from "./TopBar";

const MODE_ICONS: Record<Mode, () => React.ReactNode> = {
  requests: () => <RequestsIcon size={17} />,
  testing: () => <TestingIcon size={17} />,
  flows: () => <FlowsIcon size={17} />,
  tools: () => <ToolsIcon size={17} />,
};

interface Props {
  section: Mode;
  onMode: (mode: Mode) => void;
}

function Badge({ badge }: { badge: RailBadge | null }) {
  if (!badge) return null;
  return badge.kind === "dot" ? (
    <span className={`sb-dot tone-${badge.tone}`} aria-hidden />
  ) : (
    <span className={`sb-badge tone-${badge.tone}`} aria-hidden>
      {badge.text}
    </span>
  );
}

/** Whole days until the soonest expiry among `notAfter` (Unix seconds), rounded up; null when there are none. */
function soonestExpiryDays(notAfter: readonly number[], now: number): number | null {
  if (notAfter.length === 0) return null;
  return Math.ceil((Math.min(...notAfter) * 1000 - now) / 86_400_000);
}

const BACKGROUND: readonly StatusSection[] = ["testing", "flows", "tools"];

/**
 * The bar along the bottom of the window: the four sections as tabs, what is running or has just failed in another
 * section, and the Variables and Certificates side panels at the right.
 */
export function StatusBar({ section, onMode }: Props) {
  const status = useSectionStatus();
  const panels = useSidePanels();
  const certs = useCertificates();
  const navRef = useRef<HTMLElement>(null);
  const now = Date.now();
  const certNotAfter = certs.flatMap((c) => [c.client?.details.notAfter, c.ca?.details.notAfter]).filter((n): n is number => typeof n === "number");
  const input = { ...status, certNotAfter };
  const badge = (item: RailItem) => railBadge(item, input, now);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons) return;
    const current = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const next = nextModeIndex(current, e.key, MODES.length);
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  /** Short status words for a section, used in the tooltip and the accessible name. */
  const sectionNote = (m: Mode): string => {
    if (m === "testing") {
      if (status.testing.running) return "running";
      return status.testing.unseen && status.testing.failed > 0 ? `last run: ${status.testing.failed} failed` : "";
    }
    if (m === "flows") {
      if (status.flows.running) return "running";
      return status.flows.unseen && status.flows.failed > 0 ? "last run failed" : "";
    }
    if (m === "tools") {
      if (status.tools.running) return "running";
      return status.tools.unseen && status.tools.failed > 0 ? "last lookup had problems" : "";
    }
    return "";
  };

  // The unfilled count belongs to the open request, so it is only shown while Requests is on screen.
  const unfilled = section === "requests" ? (status.request?.unfilled ?? 0) : 0;
  const variablesNote = unfilled > 0 ? `${unfilled} unfilled` : "";
  const days = soonestExpiryDays(certNotAfter, now);
  const certNotes = [
    status.request?.certInUse ? `${status.request.certInUse} in use` : "",
    days !== null && days <= CERT_WARNING_DAYS ? (days < 0 ? "a certificate has expired" : `a certificate expires in ${days} d`) : "",
  ].filter(Boolean);
  const certNote = certNotes.join(", ");

  // The activity slot: sections still working, else the first one whose latest run failed and has not been looked at.
  const running = BACKGROUND.filter((s) => status[s].running);
  const failedSection = BACKGROUND.find((s) => status[s].unseen && status[s].failed > 0);
  const failedText = (s: StatusSection) => {
    const n = status[s].failed;
    return s === "testing" ? `${MODE_LABELS[s]}: ${n} failed` : s === "flows" ? `${MODE_LABELS[s]}: run failed` : `${MODE_LABELS[s]}: lookup had problems`;
  };

  return (
    <footer className="status-bar" aria-label="Sections and tools">
      <nav className="sb-nav" aria-label="Sections" ref={navRef} onKeyDown={onKeyDown}>
        {MODES.map((m, i) => {
          const on = section === m;
          const note = sectionNote(m);
          return (
            <button
              key={m}
              type="button"
              className={`sb-tab ${on ? "on" : ""}`}
              aria-pressed={on}
              aria-current={on ? "page" : undefined}
              aria-label={note ? `${MODE_LABELS[m]}, ${note}` : MODE_LABELS[m]}
              aria-keyshortcuts={`Control+${i + 1} Meta+${i + 1}`}
              title={`${MODE_LABELS[m]} (${MOD_KEY} ${i + 1})${note ? ` · ${note}` : ""}`}
              onClick={() => onMode(m)}
            >
              {MODE_ICONS[m]()}
              <span className="sb-label">{MODE_LABELS[m]}</span>
              <Badge badge={badge(m)} />
            </button>
          );
        })}
      </nav>
      <span className="sb-sep" aria-hidden />
      <div className="sb-activity" role="status">
        {running.length > 0 ? (
          <button type="button" className="sb-act" onClick={() => onMode(running[0])} title={`Go to ${MODE_LABELS[running[0]]}`}>
            <span className="sb-pulse" aria-hidden />
            <span className="sb-long">{running.map((s) => MODE_LABELS[s]).join(" and ")} running</span>
          </button>
        ) : failedSection ? (
          <button type="button" className="sb-act bad" onClick={() => onMode(failedSection)} title={`Go to ${MODE_LABELS[failedSection]}`}>
            <span aria-hidden>✕</span>
            <span className="sb-long">{failedText(failedSection)}</span>
          </button>
        ) : (
          <span className="sb-idle">Nothing running</span>
        )}
      </div>
      <div className="sb-right" role="group" aria-label="Tools">
        <button
          type="button"
          className={`sb-item ${panels.variables ? "on" : ""}`}
          data-variables-trigger
          aria-expanded={panels.variables}
          aria-controls="variables-panel"
          aria-label={variablesNote ? `Variables, ${variablesNote}` : "Variables"}
          title={`Variables${variablesNote ? ` · ${variablesNote}` : ""}`}
          onClick={() => toggleSidePanel("variables")}
        >
          <span className="sb-glyph" aria-hidden>
            {"{x}"}
          </span>
          {unfilled > 0 && <span className="sb-warn">{unfilled > 99 ? "99+" : unfilled}</span>}
          <span className="sb-long">{unfilled > 0 ? "unfilled" : "Variables"}</span>
        </button>
        <button
          type="button"
          className={`sb-item ${panels.certificates ? "on" : ""}`}
          data-certificates-trigger
          aria-expanded={panels.certificates}
          aria-controls="certificates-panel"
          aria-label={certNote ? `Certificates, ${certNote}` : "Certificates"}
          title={`Certificates${certNote ? ` · ${certNote}` : ""}`}
          onClick={() => toggleSidePanel("certificates")}
        >
          <LockIcon size={16} />
          <Badge badge={badge("certificates")} />
          <span className="sb-long">{section === "requests" && status.request?.certInUse ? status.request.certInUse : "Certificates"}</span>
        </button>
      </div>
    </footer>
  );
}
