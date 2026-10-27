import { useEffect, useRef } from "react";
import { maskSecrets, SECRET_MASK, storedSecrets } from "../../lib/secrets";
import type { Vars } from "../../lib/template";
import { sourceLabel, type VariableRow } from "../../lib/variables";
import { useEscape } from "../useEscape";
import "./shell.css";

interface Props {
  rows: VariableRow[];
  scriptVars: Vars;
  envName?: string;
  onEdit: (row: VariableRow) => void;
  onClearScriptVar: (name: string) => void;
  onClearAllScriptVars: () => void;
  onClose: () => void;
}

/** The placeholders the current request uses, where each value comes from, and every variable scripts have set. */
export function VariablesPopover({ rows, scriptVars, envName, onEdit, onClearScriptVar, onClearAllScriptVars, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    ref.current?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-variables-trigger]") && !t.closest(".unfilled-dot")) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const secrets = storedSecrets();
  const shown = (row: VariableRow) => (row.secret ? (row.value ? SECRET_MASK : "") : maskSecrets(row.value, secrets));
  const scriptNames = Object.keys(scriptVars);

  return (
    <div className="variables-popover" role="dialog" aria-label="Variables" ref={ref} tabIndex={-1}>
      <div className="variables-section">
        <div className="variables-head">
          <span className="section-title">This request</span>
          <span className="muted small">{envName ? `Environment: ${envName}` : "No environment"}</span>
        </div>
        {rows.length === 0 ? (
          <p className="muted small">This request has no {"{{placeholders}}"}.</p>
        ) : (
          <ul className="variables-list">
            {rows.map((row) => (
              <li key={row.name} className={row.source.kind === "unset" ? "unset" : ""}>
                <code className="var-chip">{row.name}</code>
                <span className="variables-value mono" title={row.secret ? "Secret" : shown(row)}>
                  {row.source.kind === "unset" ? <span className="muted">no value</span> : shown(row) || <span className="muted">empty</span>}
                </span>
                <span className={`source-chip source-${row.source.kind}`}>{sourceLabel(row.source)}</span>
                <button className="link-btn small" onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>
                  Edit
                </button>
                {row.source.kind === "script" && (
                  <button className="link-btn small" onClick={() => onClearScriptVar(row.name)} aria-label={`Clear ${row.name}`}>
                    Clear
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="variables-section">
        <div className="variables-head">
          <span className="section-title">Script variables</span>
          {scriptNames.length > 0 && (
            <button className="link-btn small" onClick={onClearAllScriptVars} title="Forget every variable scripts have set">
              Clear all
            </button>
          )}
        </div>
        {scriptNames.length === 0 ? (
          <p className="muted small">None yet. Scripts set these with rr.vars.set.</p>
        ) : (
          <ul className="variables-list">
            {scriptNames.map((name) => (
              <li key={name}>
                <code className="var-chip">{name}</code>
                <span className="variables-value mono" title={maskSecrets(scriptVars[name], secrets)}>
                  {maskSecrets(scriptVars[name], secrets)}
                </span>
                <button className="link-btn small" onClick={() => onClearScriptVar(name)} aria-label={`Clear ${name}`}>
                  Clear
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
