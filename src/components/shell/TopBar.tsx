import { useRef } from "react";
import { ENV_COLOR_VARS, type Environment } from "../../lib/environments";
import { BrandLockup } from "../BrandMark";
import { overlayTitleBar } from "../../lib/windowChrome";
import { PencilIcon, SearchIcon } from "./Icons";

export type Mode = "requests" | "testing" | "flows";

interface Props {
  mode: Mode;
  onMode: (mode: Mode) => void;
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
  /** Shows the Variables button next to the environment switch. */
  onVariables?: () => void;
  variablesOpen?: boolean;
}

const MODE_LABELS: Record<Mode, string> = { requests: "Requests", testing: "Testing", flows: "Flows" };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

/** The one bar at the top of both modes: brand, switcher, quick open, environment, mode tabs. */
export function TopBar(props: Props) {
  return (
    // With the macOS overlay title bar, empty parts of the top bar drag the window; buttons and fields still click.
    <header className="topbar" data-tauri-drag-region={overlayTitleBar ? "deep" : undefined}>
      <BrandLockup />
      {props.switcher}
      <button className="quick-open-field" onClick={props.onQuickOpen} aria-label="Quick open" aria-keyshortcuts="Control+K Meta+K">
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
      />
      {props.onVariables && (
        <button
          className={`secondary ghost topbar-variables ${props.variablesOpen ? "active" : ""}`}
          data-variables-trigger
          aria-expanded={!!props.variablesOpen}
          onClick={props.onVariables}
          title="Placeholders this request uses and script variables"
        >
          Variables
        </button>
      )}
      <nav className="mode-tabs" aria-label="Mode">
        {(["requests", "testing", "flows"] as const).map((m) => (
          <button key={m} className={props.mode === m ? "active" : ""} aria-current={props.mode === m ? "page" : undefined} onClick={() => props.onMode(m)}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </nav>
    </header>
  );
}

interface EnvProps {
  environments: Environment[];
  activeId: string | null;
  onChange: (id: string | null) => void;
  onEdit?: () => void;
  title?: string;
}

/** One button per environment plus None; a select when there are more than four. Arrow keys move between options. */
export function EnvSwitch({ environments, activeId, onChange, onEdit, title }: EnvProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const options: { id: string | null; name: string; color?: string }[] = [
    { id: null, name: "None" },
    ...environments.map((e) => ({ id: e.id, name: e.name || "(unnamed)", color: e.color && e.color !== "none" ? ENV_COLOR_VARS[e.color] : undefined })),
  ];
  const current = environments.some((e) => e.id === activeId) ? activeId : null;

  const edit = onEdit && (
    <button className="env-edit-btn" onClick={onEdit} aria-label="Edit environments" title="Add or edit environments">
      <PencilIcon />
    </button>
  );

  if (environments.length > 4) {
    return (
      <div className="env-switch" title={title}>
        <select value={current ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Environment">
          {options.map((o) => (
            <option key={o.id ?? ""} value={o.id ?? ""}>
              {o.color ? "● " : ""}{o.name}
            </option>
          ))}
        </select>
        {edit}
      </div>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === current);
    let next = i;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else next = (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
    onChange(options[next].id);
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons?.[next]?.focus();
  };

  return (
    <div className="env-switch" title={title}>
      <div className="segmented" role="radiogroup" aria-label="Environment" ref={groupRef} onKeyDown={onKeyDown}>
        {options.map((o) => {
          const on = o.id === current;
          return (
            <button key={o.id ?? ""} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={on ? "on" : ""} onClick={() => onChange(o.id)}>
              {o.color ? <span className="env-dot" style={{ background: o.color }} aria-hidden /> : on && o.id !== null && <span className="env-dot" aria-hidden />}
              {o.name}
            </button>
          );
        })}
      </div>
      {edit}
    </div>
  );
}
