import { useEffect, useMemo, useRef, useState } from "react";
import { ENV_COLOR_VARS, type Environment } from "../../lib/environments";
import { maskSecrets, SECRET_MASK, storedSecrets } from "../../lib/secrets";
import { load, save } from "../../lib/storage";
import { variableIndex, type SidebarEnvGroup, type SidebarEnvRow } from "../../lib/variables";
import { useEscape } from "../useEscape";
import { useVariables, type VariablesApi } from "./VariablesContext";
import "./variables.css";

const PANEL_KEY = "rest-runner.variables-panel";
/** Below this window width the panel floats over the response instead of sharing the row. */
export const DOCK_MIN_WIDTH = 1240;

export type VariablesFilter = "request" | "all";

export interface VariablesPanelState {
  open: boolean;
  filter: VariablesFilter;
  othersOpen: boolean;
}

export function loadPanelState(): VariablesPanelState {
  const s = load<Partial<VariablesPanelState>>(PANEL_KEY, {});
  return { open: s.open === true, filter: s.filter === "all" ? "all" : "request", othersOpen: s.othersOpen === true };
}

export function savePanelState(state: VariablesPanelState) {
  save(PANEL_KEY, state);
}

interface Props {
  state: VariablesPanelState;
  onState: (patch: Partial<VariablesPanelState>) => void;
  /** Names the current request uses, in order of appearance. */
  used: string[];
  docked: boolean;
  onClose: () => void;
  onEditEnvironments: (varId?: string) => void;
  onSwitchEnvironment: (id: string) => void;
}

function EnvDot({ env }: { env: Environment }) {
  const color = env.color && env.color !== "none" ? ENV_COLOR_VARS[env.color] : "var(--muted)";
  return <span className="env-dot" style={{ background: color }} aria-hidden />;
}

/** A value that turns into an input on click. Enter or leaving saves, Esc cancels. */
function InlineValue({ value, secret, label, onSave }: { value: string; secret: boolean; label: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [reveal, setReveal] = useState(false);
  const secrets = storedSecrets();
  const shown = secret ? (value ? SECRET_MASK : "") : maskSecrets(value, secrets);
  const done = (commit: boolean) => {
    setEditing(false);
    if (commit && draft !== value) onSave(draft);
  };
  if (editing) {
    return (
      <input
        className="variables-input mono"
        autoFocus
        type={secret && !reveal ? "password" : "text"}
        aria-label={`Value of ${label}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") done(true);
          else if (e.key === "Escape") {
            e.preventDefault();
            done(false);
          }
        }}
      />
    );
  }
  return (
    <span className="variables-value-wrap">
      <button
        className="variables-value mono"
        title={secret ? "Secret. Click to edit" : "Click to edit"}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        aria-label={`Edit ${label}`}
      >
        {reveal && secret ? value || <span className="muted">empty</span> : shown || <span className="muted">empty</span>}
      </button>
      {secret && (
        <button className="link-btn small" onClick={() => setReveal((r) => !r)} aria-pressed={reveal} aria-label={`${reveal ? "Hide" : "Show"} ${label}`}>
          {reveal ? "Hide" : "Show"}
        </button>
      )}
    </span>
  );
}

/** A name with no value yet: type one and add it to the active environment. */
function MissingRow({ name, envName, onAdd }: { name: string; envName: string | null; onAdd: (value: string, secret: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(false);
  const submit = () => {
    onAdd(value, secret);
    setOpen(false);
  };
  return (
    <li className="variables-missing">
      <div className="variables-row">
        <code className="var-chip">{name}</code>
        <span className="warn small">no value</span>
        {!open && (
          <button className="link-btn small" onClick={() => setOpen(true)}>
            {envName ? `Add to ${envName}` : "Create Environment 1 and add"}
          </button>
        )}
      </div>
      {open && (
        <div className="variables-add">
          <input
            className="variables-input mono"
            autoFocus
            type={secret ? "password" : "text"}
            placeholder={envName ? `Value for ${envName}` : "Value"}
            aria-label={`Value of ${name}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <label className="small">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Secret
          </label>
          <button className="link-btn small" onClick={submit}>
            Add
          </button>
        </div>
      )}
    </li>
  );
}

function AddVariable({ envName, onAdd }: { envName: string; onAdd: (name: string, value: string, secret: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(false);
  const submit = () => {
    if (name.trim() === "") return;
    onAdd(name.trim(), value, secret);
    setName("");
    setValue("");
    setSecret(false);
    setOpen(false);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };
  if (!open)
    return (
      <button className="link-btn small variables-add-link" onClick={() => setOpen(true)}>
        + Add variable
      </button>
    );
  return (
    <div className="variables-add">
      <input className="variables-input mono" autoFocus placeholder="name" aria-label="Variable name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
      <input className="variables-input mono" type={secret ? "password" : "text"} placeholder={`value in ${envName}`} aria-label="Variable value" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={keys} />
      <label className="small">
        <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Secret
      </label>
      <button className="link-btn small" onClick={submit} disabled={name.trim() === ""}>
        Add
      </button>
    </div>
  );
}

function EnvRows({ group, api }: { group: SidebarEnvGroup; api: VariablesApi }) {
  const row = (r: SidebarEnvRow) => {
    return (
      <li key={r.varId} className={`variables-row ${r.overriddenBy ? "overridden" : ""}`}>
        <code className="var-chip">{r.name}</code>
        <InlineValue
          value={r.value}
          secret={r.secret}
          label={r.name}
          onSave={(v) => api.setValue(r.name, { kind: "env", envId: group.env.id, envName: group.env.name, varId: r.varId, value: r.value, secret: r.secret, active: group.env.id === api.activeEnvId }, v)}
        />
        {r.overriddenBy ? <span className="tag">{r.overriddenBy === "script" ? "by Script" : "by later row"}</span> : r.used ? <span className="tag">used</span> : <span />}
      </li>
    );
  };
  return <ul className="variables-list">{group.rows.map(row)}</ul>;
}

/** The Variables sidebar: every variable by priority, editable in place. */
export function VariablesPanel({ state, onState, used, docked, onClose, onEditEnvironments, onSwitchEnvironment }: Props) {
  const api = useVariables();
  const ref = useRef<HTMLElement>(null);
  const [nameFilter, setNameFilter] = useState("");

  useEscape(onClose, state.open && !docked);
  useEffect(() => {
    if (!state.open || docked) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-variables-trigger]") && !t.closest(".unfilled-dot") && !t.closest(".toast")) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [state.open, docked, onClose]);

  const groups = useMemo(
    () => (api ? variableIndex(api.environments, api.activeEnvId, api.scriptVars, state.filter === "request" ? used : null) : null),
    [api, state.filter, used],
  );
  if (!api || !groups || !state.open) return null;

  const activeEnv = api.environments.find((e) => e.id === api.activeEnvId) ?? null;
  const needle = nameFilter.trim().toLowerCase();
  const match = (name: string) => needle === "" || name.toLowerCase().includes(needle);
  const narrow = (g: SidebarEnvGroup): SidebarEnvGroup => ({ ...g, rows: g.rows.filter((r) => match(r.name)) });
  const missing = groups.missing.filter(match);
  const script = groups.script.filter((r) => match(r.name));
  const active = groups.active ? narrow(groups.active) : null;
  const others = groups.others.map(narrow).filter((g) => g.rows.length > 0);
  const nothing = missing.length === 0 && script.length === 0 && !active?.rows.length && others.length === 0;

  return (
    <aside
      ref={ref}
      className={`variables-panel ${docked ? "docked" : "overlay"}`}
      aria-label="Variables"
      id="variables-panel"
      onKeyDown={(e) => {
        if (docked && e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="variables-panel-head">
        <strong>Variables</strong>
        {activeEnv ? (
          <span className="muted small variables-env-name">
            <EnvDot env={activeEnv} /> {activeEnv.name || "(unnamed)"}
          </span>
        ) : (
          <span className="muted small">No environment</span>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close Variables" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="variables-panel-tools">
        <div className="seg-toggle" role="group" aria-label="Which variables to list">
          <button className={state.filter === "request" ? "on" : ""} aria-pressed={state.filter === "request"} onClick={() => onState({ filter: "request" })}>
            This request
          </button>
          <button className={state.filter === "all" ? "on" : ""} aria-pressed={state.filter === "all"} onClick={() => onState({ filter: "all" })}>
            All
          </button>
        </div>
        <input className="variables-input" placeholder="Filter by name" aria-label="Filter variables by name" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
      </div>

      <div className="variables-panel-body">
        {missing.length > 0 && (
          <section>
            <div className="variables-head">
              <span className="section-title">Missing</span>
              <span className="tag warn">{missing.length}</span>
            </div>
            <ul className="variables-list">
              {missing.map((name) => (
                <MissingRow key={name} name={name} envName={activeEnv ? activeEnv.name || "(unnamed)" : null} onAdd={(value, secret) => api.add(name, value, secret)} />
              ))}
            </ul>
          </section>
        )}

        {(script.length > 0 || state.filter === "all") && (
          <section>
            <div className="variables-head">
              <span className="section-title">Script variables</span>
              {script.length > 0 && (
                <button className="link-btn small" onClick={api.clearAllScript} title="Forget every variable scripts have set">
                  Clear all
                </button>
              )}
            </div>
            {script.length === 0 ? (
              <p className="muted small">None yet. Scripts set these with rr.vars.set.</p>
            ) : (
              <ul className="variables-list">
                {script.map((r) => (
                  <li key={r.name} className="variables-row">
                    <code className="var-chip">{r.name}</code>
                    <InlineValue value={r.value} secret={false} label={r.name} onSave={(v) => api.setValue(r.name, { kind: "script", value: r.value }, v)} />
                    <span className="tag">
                      {r.hidesEnv ? "wins " : ""}
                      <button className="link-btn small" onClick={() => api.clearScript(r.name)} aria-label={`Clear ${r.name}`}>
                        Clear
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <div className="variables-head">
            <span className="section-title">{activeEnv ? <>Env · {activeEnv.name || "(unnamed)"} (active)</> : "Environment"}</span>
          </div>
          {active && active.rows.length > 0 ? (
            <EnvRows group={active} api={api} />
          ) : (
            <p className="muted small">{activeEnv ? (state.filter === "request" ? "Nothing here is used by this request." : "No variables yet.") : "Pick or create an environment to keep values."}</p>
          )}
          {activeEnv && <AddVariable envName={activeEnv.name || "(unnamed)"} onAdd={(name, value, secret) => api.add(name, value, secret)} />}
        </section>

        {others.length > 0 && (
          <section>
            <button className="variables-fold" aria-expanded={state.othersOpen} onClick={() => onState({ othersOpen: !state.othersOpen })}>
              {state.othersOpen ? "▾" : "▸"} Other environments ({others.length})
            </button>
            {state.othersOpen &&
              others.map((g) => (
                <div key={g.env.id} className="variables-other">
                  <div className="variables-head">
                    <span className="small">
                      <EnvDot env={g.env} /> {g.env.name || "(unnamed)"}
                    </span>
                    <button className="link-btn small" onClick={() => onSwitchEnvironment(g.env.id)}>
                      Switch to
                    </button>
                  </div>
                  <EnvRows group={g} api={api} />
                </div>
              ))}
          </section>
        )}

        {nothing && activeEnv && state.filter === "request" && used.length === 0 && <p className="muted small">This request has no {"{{placeholders}}"}.</p>}
      </div>

      <div className="variables-panel-foot">
        <button className="link-btn small" onClick={() => onEditEnvironments()}>
          Edit environments…
        </button>
      </div>
    </aside>
  );
}
