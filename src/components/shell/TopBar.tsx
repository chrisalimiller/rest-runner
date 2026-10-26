import { useRef } from "react";
import { ENV_COLOR_VARS, type Environment } from "../../lib/environments";
import { BrandLockup } from "../BrandMark";
import { overlayTitleBar } from "../../lib/windowChrome";
import { MODES, nextModeIndex, topBarLayout } from "../../lib/topBar";
import { useViewportWidth } from "../useViewportWidth";
import { ChevronDownIcon, FlowsIcon, PencilIcon, RequestsIcon, SearchIcon, TestingIcon } from "./Icons";
import { OverflowMenu } from "./OverflowMenu";

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

export const MODE_LABELS: Record<Mode, string> = { requests: "Requests", testing: "Testing", flows: "Flows" };

const MODE_ICONS: Record<Mode, () => React.ReactNode> = {
  requests: () => <RequestsIcon />,
  testing: () => <TestingIcon />,
  flows: () => <FlowsIcon />,
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

/** The one bar at the top of both modes: brand, switcher, quick open, environment, section switcher. */
export function TopBar(props: Props) {
  const layout = topBarLayout(useViewportWidth(), props.environments.length);
  return (
    // With the macOS overlay title bar, empty parts of the top bar drag the window; buttons and fields still click.
    <header className="topbar" data-tauri-drag-region={overlayTitleBar ? "deep" : undefined}>
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
      <ModeSwitch mode={props.mode} onMode={props.onMode} />
    </header>
  );
}

/** One segmented control for the three sections: the selected one shows its name, the others are icons. Arrow keys move focus. */
export function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  const ref = useRef<HTMLElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons) return;
    const current = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const next = nextModeIndex(current, e.key, MODES.length);
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };
  return (
    <nav className="mode-switch" aria-label="Section" ref={ref} onKeyDown={onKeyDown}>
      {MODES.map((m, i) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            className={on ? "on" : ""}
            aria-pressed={on}
            aria-current={on ? "page" : undefined}
            aria-keyshortcuts={`Control+${i + 1} Meta+${i + 1}`}
            title={`${MODE_LABELS[m]} (${MOD_KEY} ${i + 1})`}
            onClick={() => onMode(m)}
          >
            {MODE_ICONS[m]()}
            <span className={on ? "mode-switch-label" : "visually-hidden"}>{MODE_LABELS[m]}</span>
          </button>
        );
      })}
    </nav>
  );
}

interface EnvProps {
  environments: Environment[];
  activeId: string | null;
  onChange: (id: string | null) => void;
  onEdit?: () => void;
  title?: string;
  /** Show the choices in a dropdown (with colour dots) instead of one button each. */
  dropdown?: boolean;
}

/** One button per environment plus None; a select when there are more than four. Arrow keys move between options. */
export function EnvSwitch({ environments, activeId, onChange, onEdit, title, dropdown }: EnvProps) {
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

  if (dropdown) {
    const shown = options.find((o) => o.id === current) ?? options[0];
    return (
      <div className="env-switch" title={title}>
        <OverflowMenu
          label="Environment"
          triggerTitle={`Environment: ${shown.name}`}
          triggerClass="env-dropdown-btn"
          trigger={
            <>
              {shown.color ? <span className="env-dot" style={{ background: shown.color }} aria-hidden /> : null}
              <span className="env-dropdown-name">{shown.name}</span>
              <ChevronDownIcon />
            </>
          }
          items={options.map((o) => ({
            label: o.name,
            icon: o.color ? <span className="env-dot" style={{ background: o.color }} /> : undefined,
            checked: o.id === current,
            onSelect: () => onChange(o.id),
          }))}
        />
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
