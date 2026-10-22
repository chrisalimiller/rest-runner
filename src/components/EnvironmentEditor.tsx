import { useState } from "react";
import { newEnvironment, type Environment } from "../lib/environments";
import { KeyValueEditor } from "./KeyValueEditor";

interface Props {
  environments: Environment[];
  activeId: string | null;
  onChange: (environments: Environment[]) => void;
  onClose: () => void;
}

/** A dialog for adding, renaming, editing and deleting environments. */
export function EnvironmentEditor({ environments, activeId, onChange, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(activeId ?? environments[0]?.id ?? null);
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
    if (!window.confirm(`Delete the environment "${env.name}"?`)) return;
    const rest = environments.filter((e) => e.id !== env.id);
    onChange(rest);
    setSelectedId(rest[0]?.id ?? null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Environments">
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
                <p className="muted small">
                  Use these anywhere in a request as {"{{name}}"}. In a batch run, a CSV column with the same name wins.
                </p>
                <KeyValueEditor rows={selected.vars} onChange={(vars) => update({ ...selected, vars })} keyPlaceholder="Variable" />
              </>
            ) : (
              <p className="muted">
                No environments yet. Add one to keep values like base URLs and tokens for Dev, Test and Prod in one place.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
