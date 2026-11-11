import { useRef } from "react";
import { useCertificates } from "../CertificatesDialog";
import { MODES, nextModeIndex } from "../../lib/topBar";
import { overlayTitleBar } from "../../lib/windowChrome";
import { CERT_WARNING_DAYS, railBadge, useSectionStatus, type RailBadge, type RailItem } from "../../lib/sectionStatus";
import { toggleSidePanel, useSidePanels } from "../../lib/sidePanels";
import { FlowsIcon, LockIcon, RequestsIcon, TestingIcon, ToolsIcon } from "./Icons";
import { MOD_KEY, MODE_LABELS, type Mode } from "./TopBar";

const MODE_ICONS: Record<Mode, () => React.ReactNode> = {
  requests: () => <RequestsIcon size={18} />,
  testing: () => <TestingIcon size={18} />,
  flows: () => <FlowsIcon size={18} />,
  tools: () => <ToolsIcon size={18} />,
};

interface Props {
  section: Mode;
  onMode: (mode: Mode) => void;
}

function Badge({ badge }: { badge: RailBadge | null }) {
  if (!badge) return null;
  return badge.kind === "dot" ? (
    <span className={`rail-dot tone-${badge.tone}`} aria-hidden />
  ) : (
    <span className={`rail-badge tone-${badge.tone}`} aria-hidden>
      {badge.text}
    </span>
  );
}

/** Whole days until the soonest expiry among `notAfter` (Unix seconds), rounded up; null when there are none. */
function soonestExpiryDays(notAfter: readonly number[], now: number): number | null {
  if (notAfter.length === 0) return null;
  return Math.ceil((Math.min(...notAfter) * 1000 - now) / 86_400_000);
}

/** The slim bar on the window's right edge: the four sections, then the Variables and Certificates side panels. */
export function SideRail({ section, onMode }: Props) {
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

  return (
    <aside className="side-rail" aria-label="Sections and tools">
      <nav className="rail-group" aria-label="Sections" ref={navRef} onKeyDown={onKeyDown}>
        {MODES.map((m, i) => {
          const on = section === m;
          const note = sectionNote(m);
          return (
            <button
              key={m}
              type="button"
              className={`rail-btn ${on ? "on section" : ""}`}
              aria-pressed={on}
              aria-current={on ? "page" : undefined}
              aria-label={note ? `${MODE_LABELS[m]}, ${note}` : MODE_LABELS[m]}
              aria-keyshortcuts={`Control+${i + 1} Meta+${i + 1}`}
              title={`${MODE_LABELS[m]} (${MOD_KEY} ${i + 1})${note ? ` · ${note}` : ""}`}
              onClick={() => onMode(m)}
            >
              {MODE_ICONS[m]()}
              <Badge badge={badge(m)} />
            </button>
          );
        })}
      </nav>
      <div className="rail-group rail-tools" role="group" aria-label="Tools">
        <div className="rail-spacer" data-tauri-drag-region={overlayTitleBar ? "" : undefined} />
        <button
          type="button"
          className={`rail-btn ${panels.variables ? "on" : ""}`}
          data-variables-trigger
          aria-expanded={panels.variables}
          aria-controls="variables-panel"
          aria-label={variablesNote ? `Variables, ${variablesNote}` : "Variables"}
          title={`Variables${variablesNote ? ` · ${variablesNote}` : ""}`}
          onClick={() => toggleSidePanel("variables")}
        >
          <span className="rail-glyph" aria-hidden>
            {"{x}"}
          </span>
          <Badge badge={section === "requests" ? badge("variables") : null} />
        </button>
        <button
          type="button"
          className={`rail-btn ${panels.certificates ? "on" : ""}`}
          data-certificates-trigger
          aria-expanded={panels.certificates}
          aria-controls="certificates-panel"
          aria-label={certNote ? `Certificates, ${certNote}` : "Certificates"}
          title={`Certificates${certNote ? ` · ${certNote}` : ""}`}
          onClick={() => toggleSidePanel("certificates")}
        >
          <LockIcon size={17} />
          <Badge badge={badge("certificates")} />
        </button>
      </div>
    </aside>
  );
}
