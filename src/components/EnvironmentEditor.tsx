import { useEffect, useRef, useState } from "react";
import { ENV_COLORS, ENV_COLOR_VARS, newEnvironment, type Environment, type EnvColor } from "../lib/environments";
import { KeyValueEditor } from "./KeyValueEditor";
import { useToast } from "./shell/Toast";
import { Modal } from "./shell/Modal";

interface Props {
  environments: Environment[];
  activeId: string | null;
  onChange: (environments: Environment[]) => void;
  onClose: () => void;
  /** Open on the environment holding this variable row and put the cursor in its value. */
  focusVarId?: string;
}

/** A dialog for adding, renaming, editing and deleting environments. */
export function EnvironmentEditor({ environments, activeId, onChange, onClose, focusVarId }: Props) {
  const toast = useToast();
  const latest = useRef(environments);
  latest.current = environments;
  const [selectedId, setSelectedId] = useState<string | null>(
    () => environments.find((e) => focusVarId && e.vars.some((v) => v.id === focusVarId))?.id ?? activeId ?? environments[0]?.id ?? null,
  );
  useEffect(() => {
    if (focusVarId) document.querySelector<HTMLInputElement>(`[data-row-value="${focusVarId}"]`)?.focus();
  }, [focusVarId]);
  const selected = environments.find((e) => e.id === selectedId) ?? null;

  const update = (env: Environment) => onChange(environments.map((e) => (e.id === env.id ? env : e)));

  const add = () => {
    const env = newEnvironment(`Environment ${environments.length + 1}`);
    onChange([...environments, env]);
    setSelectedId(env.id);
  };

  const duplicate = (env: Environment) => {
    const copy = { ...structuredClone(env), id: newEnvironment("").id, name: `${env.name} copy` };
    onChange([...environments, copy]);
    setSelectedId(copy.id);
  };

  const remove = (env: Environment) => {
    const index = environments.findIndex((e) => e.id === env.id);
    const rest = environments.filter((e) => e.id !== env.id);
    onChange(rest);
    setSelectedId(rest[0]?.id ?? null);
    toast.show({
      message: `Deleted environment "${env.name || "(unnamed)"}"`,
      onUndo: () => {
        const cur = latest.current;
        if (cur.some((e) => e.id === env.id)) return;
        onChange([...cur.slice(0, index), env, ...cur.slice(index)]);
        setSelectedId(env.id);
      },
    });
  };

  return (
    <Modal label="Environments" onClose={onClose}>
      <div className="modal-head">
        <h3>Environments</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="env-layout">
        <div className="env-list">
          {environments.map((e) => (
            <button key={e.id} className={e.id === selectedId ? "active" : ""} onClick={() => setSelectedId(e.id)}>
              {e.name || "(unnamed)"}
            </button>
          ))}
          <button className="link-btn" onClick={add}>
            + Add environment
          </button>
        </div>
        <div className="env-edit">
          {selected ? (
            <>
              <div className="env-edit-head">
                <input value={selected.name} onChange={(e) => update({ ...selected, name: e.target.value })} aria-label="Environment name" />
                <button className="secondary" onClick={() => duplicate(selected)}>
                  Duplicate
                </button>
                <button className="secondary danger" onClick={() => remove(selected)}>
                  Delete
                </button>
              </div>
              <div className="env-color-row" role="radiogroup" aria-label="Environment colour">
                <span className="muted small">Colour</span>
                {ENV_COLORS.map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={(selected.color ?? "none") === c}
                    aria-label={c === "none" ? "No colour" : c}
                    title={c === "none" ? "No colour" : `${c[0].toUpperCase()}${c.slice(1)}`}
                    className={`env-swatch ${(selected.color ?? "none") === c ? "on" : ""} ${c === "none" ? "none" : ""}`}
                    style={c === "none" ? undefined : { background: ENV_COLOR_VARS[c as Exclude<EnvColor, "none">] }}
                    onClick={() => update({ ...selected, color: c })}
                  />
                ))}
                <span className="muted small">A coloured environment outlines Send, Run suite and Run, and puts its name on them.</span>
              </div>
              <p className="muted small">
                Use these anywhere in a request as {"{{name}}"}. In a batch run, a CSV column with the same name wins. Lock a value to mask it on screen and leave it out of exports.
              </p>
              <KeyValueEditor rows={selected.vars} onChange={(vars) => update({ ...selected, vars })} keyPlaceholder="Variable" secrets />
            </>
          ) : (
            <p className="muted">
              No environments yet. Add one to keep values like base URLs and tokens for Dev, Test and Prod in one place.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
