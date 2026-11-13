import { useRef } from "react";
import { useSlidingUnderline } from "../useTabMotion";
import type { DetailsTab } from "../../lib/requestSummary";

export const TAB_LABELS: Record<DetailsTab, string> = { params: "Params", auth: "Auth", headers: "Headers", body: "Body", scripts: "Scripts" };

interface Props {
  /** Tabs to show, in order. Body is left out for methods that send none. */
  tabs: readonly DetailsTab[];
  active: DetailsTab;
  onTab: (tab: DetailsTab) => void;
  /** The element the active tab controls (the panel under the strip). */
  panelId: string;
  /** Text after a tab name: a count, a body type, or a dot. Empty for nothing. */
  marks: Record<DetailsTab, string>;
  /** Tabs to flag in amber, with the reason shown as a tooltip. */
  warnings?: Partial<Record<DetailsTab, string>>;
  /** Right end of the strip (certificate chip, a note). */
  end?: React.ReactNode;
}

export const tabDomId = (panelId: string, tab: DetailsTab) => `${panelId}-tab-${tab}`;

/** Params, Auth, Headers, Body and Scripts as one row of tabs under the URL, with what each holds on the tab. */
export function RequestTabs({ tabs, active, onTab, panelId, marks, warnings, end }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  useSlidingUnderline(strip, active);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.indexOf(active);
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") to = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = tabs.length - 1;
    if (to < 0) return;
    e.preventDefault();
    onTab(tabs[to]);
    requestAnimationFrame(() => strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus());
  };

  return (
    <div className="req-tabs">
      <div className="tabs slide" role="tablist" aria-label="Request" ref={strip} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t}
            id={tabDomId(panelId, t)}
            role="tab"
            aria-selected={active === t}
            aria-controls={panelId}
            tabIndex={active === t ? 0 : -1}
            className={active === t ? "active" : ""}
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
      {end && <div className="req-tabs-end">{end}</div>}
    </div>
  );
}
