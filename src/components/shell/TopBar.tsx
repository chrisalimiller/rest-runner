import { useRef } from "react";
import { type Environment } from "../../lib/environments";
import { BrandLockup } from "../BrandMark";
import { overlayTitleBar } from "../../lib/windowChrome";
import { topBarLayout } from "../../lib/topBar";
import { useViewportWidth } from "../useViewportWidth";
import { openUpdateDialog } from "../../lib/updateDialog";
import { InfoIcon, PencilIcon, SearchIcon } from "./Icons";
import { useTopBarFit } from "./useTopBarFit";
import { EnvPicker } from "./EnvPicker";

export type Mode = "requests" | "testing" | "flows";

interface Props {
  mode: Mode;
  onQuickOpen: () => void;
  searchPlaceholder: string;
  /** The request switcher (Requests) or the suite name (Testing). */
  switcher?: React.ReactNode;
  environments: Environment[];
  activeEnvId: string | null;
  onEnvChange: (id: string | null) => void;
  /** Shows the pencil that opens the environment editor. */
  onEditEnvironments?: () => void;
  envTitle?: string;
}

export const MODE_LABELS: Record<Mode, string> = { requests: "Requests", testing: "Testing", flows: "Flows" };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

/** The one bar at the top of each section: brand, switcher, quick open, environment. Sections and tools live in the side rail. */
export function TopBar(props: Props) {
  const width = useViewportWidth();
  const headerRef = useRef<HTMLElement>(null);
  const fit = useTopBarFit(headerRef, `${props.mode}|${props.environments.length}`);
  // The width rule is the minimum; the measured level can only collapse more.
  const rule = topBarLayout(width, props.environments.length);
  const layout = { compactSearch: rule.compactSearch || fit >= 2, envDropdown: rule.envDropdown || fit >= 3 };
  return (
    // With the macOS overlay title bar, empty parts of the top bar drag the window; buttons and fields still click.
    <header
      className="topbar"
      ref={headerRef}
      data-fit-crumbs={fit >= 1 ? "off" : undefined}
      data-fit-max={fit >= 3 ? "" : undefined}
      data-tauri-drag-region={overlayTitleBar ? "deep" : undefined}
    >
      <BrandLockup />
      {props.switcher}
      <button
        className={`quick-open-field ${layout.compactSearch ? "compact" : ""}`}
        onClick={props.onQuickOpen}
        aria-label="Quick open"
        title={layout.compactSearch ? `${props.searchPlaceholder} (${MOD_KEY} K)` : undefined}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <SearchIcon />
        <span className="quick-open-placeholder">{props.searchPlaceholder}</span>
        <kbd>{MOD_KEY} K</kbd>
      </button>
      <span className="topbar-gap" />
      <EnvSwitch
        environments={props.environments}
        activeId={props.activeEnvId}
        onChange={props.onEnvChange}
        onEdit={props.onEditEnvironments}
        title={props.envTitle}
        dropdown={layout.envDropdown}
      />
      <button className="icon-btn topbar-about" onClick={openUpdateDialog} aria-label="Settings and about" title="Settings and about">
        <InfoIcon />
      </button>
    </header>
  );
}

interface EnvProps {
  environments: Environment[];
  activeId: string | null;
  onChange: (id: string | null) => void;
  onEdit?: () => void;
  title?: string;
  /** Unused: the picker is always a popover. */
  dropdown?: boolean;
}

/** The environment picker: a fixed-width trigger with a searchable popover, plus the edit pencil. */
export function EnvSwitch({ environments, activeId, onChange, onEdit, title }: EnvProps) {
  const current = environments.some((e) => e.id === activeId) ? activeId : null;
  return (
    <div className="env-switch" title={title}>
      <EnvPicker environments={environments} activeId={current} onChange={onChange} />
      {onEdit && (
        <button className="env-edit-btn" onClick={onEdit} aria-label="Edit environments" title="Add or edit environments">
          <PencilIcon />
        </button>
      )}
    </div>
  );
}
