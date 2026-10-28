import { useEffect, useId, useRef } from "react";
import type { DetailsItem, DetailsTab } from "../../lib/requestSummary";
import { SlidersIcon } from "../shell/Icons";
import { useEscape } from "../useEscape";

const TAB_LABELS: Record<DetailsTab, string> = { params: "Params", auth: "Auth", headers: "Headers", scripts: "Scripts" };

interface SummaryProps {
  items: DetailsItem[];
  /** The Request details button is left out when the details are docked in place of the body. */
  showToggle: boolean;
  open: boolean;
  detailsId: string;
  onToggle: (opener: HTMLElement) => void;
  onPick: (tab: DetailsTab, opener: HTMLElement) => void;
  /** Certificate chip, then whatever the right end holds (body type, validity, Format). */
  children?: React.ReactNode;
  end?: React.ReactNode;
}

/** The one line under the URL: the Request details button, what Params / Auth / Headers / Scripts hold, and the body controls. */
export function RequestSummary({ items, showToggle, open, detailsId, onToggle, onPick, children, end }: SummaryProps) {
  return (
    <div className="req-summary">
      {showToggle && (
        <button className="req-details-btn" aria-expanded={open} aria-controls={detailsId} onClick={(e) => onToggle(e.currentTarget)} title="Params, Auth, Headers and Scripts">
          <SlidersIcon />
          Request details
        </button>
      )}
      <span className="req-summary-items">
        {items.map((item, i) => (
          <span key={item.id} className="req-summary-item">
            {i > 0 && (
              <span className="req-summary-dot" aria-hidden>
                ·
              </span>
            )}
            <button
              className={`req-summary-link ${item.tone ?? ""}`}
              data-details-item={item.id}
              onClick={(e) => onPick(item.id, e.currentTarget)}
              title={item.tone === "missing" ? "No value for a placeholder here" : `Open ${TAB_LABELS[item.id]}`}
            >
              {item.text}
            </button>
          </span>
        ))}
      </span>
      {children}
      {end && <span className="req-summary-end">{end}</span>}
    </div>
  );
}

interface DrawerProps {
  id: string;
  open: boolean;
  /** Fills the space of the body (methods without one): no slide, shadow or close button. */
  docked: boolean;
  tab: DetailsTab;
  onTab: (tab: DetailsTab) => void;
  onClose: () => void;
  /** Tab titles with a count or a dot: "Params 2", "Scripts •". */
  marks: Record<DetailsTab, string>;
  /** Tabs to flag in amber, with the reason shown as a tooltip. */
  warnings?: Partial<Record<DetailsTab, string>>;
  children: React.ReactNode;
}

/** Params, Auth, Headers and Scripts, in a panel that slides up over the body from the summary line. */
export function RequestDetailsDrawer({ id, open, docked, tab, onTab, onClose, marks, warnings, children }: DrawerProps) {
  const uid = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const shown = open || docked;
  // Declared before the focus effect so it remembers the opener, not the tab.
  useEscape(onClose, open && !docked);

  useEffect(() => {
    if (open && !docked) tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [open, docked]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const order: DetailsTab[] = ["params", "auth", "headers", "scripts"];
    const i = order.indexOf(tab);
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % order.length;
    else if (e.key === "ArrowLeft") to = (i - 1 + order.length) % order.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = order.length - 1;
    if (to < 0) return;
    e.preventDefault();
    onTab(order[to]);
    requestAnimationFrame(() => tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus());
  };

  return (
    <div id={id} className={`req-details ${shown ? "open" : ""} ${docked ? "docked" : ""}`} role="dialog" aria-label="Request details" aria-modal="false">
      <div className="req-details-head">
        <div className="tabs" role="tablist" aria-label="Request details" ref={tabs} onKeyDown={onKeyDown}>
          {(Object.keys(TAB_LABELS) as DetailsTab[]).map((t) => (
            <button
              key={t}
              id={`${uid}-${t}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls={`${uid}-panel`}
              tabIndex={tab === t ? 0 : -1}
              className={tab === t ? "active" : ""}
              onClick={() => onTab(t)}
            >
              {TAB_LABELS[t]}
              {marks[t] && (
                <span className={`req-details-mark ${warnings?.[t] ? "warn" : ""}`} title={warnings?.[t]}>
                  {marks[t]}
                </span>
              )}
            </button>
          ))}
        </div>
        {!docked && (
          <button className="icon-btn req-details-close" onClick={onClose} aria-label="Close request details" title="Close (Esc)">
            ×
          </button>
        )}
      </div>
      <div className="req-details-body" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${tab}`}>
        {children}
      </div>
    </div>
  );
}
