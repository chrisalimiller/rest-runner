import { useEffect, useMemo, useRef, useState } from "react";
import { ENV_COLORS, ENV_COLOR_VARS, newEnvironment, type Environment, type EnvColor } from "../lib/environments";
import { addMissingVar, buildMatrix, findDuplicateNames, joinRowNumbers, revealKey, setVarValue } from "../lib/envVars";
import { filterEnvs } from "../lib/envPicker";
import { openImportDialog } from "../lib/importDialog";
import { EnvCompare } from "./EnvCompare";
import { EnvVarsTable } from "./EnvVarsTable";
import { AlertIcon, SearchIcon } from "./shell/Icons";
import { Modal } from "./shell/Modal";
import { Segmented } from "./shell/Segmented";
import { useToast } from "./shell/Toast";
import "./dlg.css";
import "./environmentEditor.css";

interface Props {
  environments: Environment[];
  activeId: string | null;
  onChange: (environments: Environment[]) => void;
  onClose: () => void;
  /** Open on the environment holding this variable row and put the cursor in its value. */
  focusVarId?: string;
}

type View = "this" | "compare";

/** Below this dialog width the Compare matrix has no room, so only "This environment" is offered. */
export const COMPARE_MIN_WIDTH = 640;

const colorLabel = (c: EnvColor) => (c === "none" ? "No colour" : `${c[0].toUpperCase()}${c.slice(1)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A dialog for adding, renaming, editing and deleting environments, and comparing their variables. */
export function EnvironmentEditor({ environments, activeId, onChange, onClose, focusVarId }: Props) {
  const toast = useToast();
  const latest = useRef(environments);
  latest.current = environments;
  const body = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => environments.find((e) => focusVarId && e.vars.some((v) => v.id === focusVarId))?.id ?? activeId ?? environments[0]?.id ?? null,
  );
  const [view, setView] = useState<View>("this");
  const [query, setQuery] = useState("");
  // Secret values that are showing, as `envId:rowId`. Lives only while the dialog is open; never saved or exported.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (focusVarId) document.querySelector<HTMLInputElement>(`[data-row-value="${focusVarId}"]`)?.focus();
  }, [focusVarId]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selected = environments.find((e) => e.id === selectedId) ?? null;
  const canCompare = (width === null || width >= COMPARE_MIN_WIDTH) && environments.length > 0;
  const mode: View = canCompare ? view : "this";

  const duplicates = useMemo(() => findDuplicateNames(selected?.vars ?? []), [selected]);
  const missing = useMemo(() => (mode === "compare" ? buildMatrix(environments).missing : 0), [mode, environments]);
  const dupCount = duplicates.groups.length;
  const shownEnvs = useMemo(() => filterEnvs(environments, query), [environments, query]);

  const update = (env: Environment) => onChange(environments.map((e) => (e.id === env.id ? env : e)));
  const toggleReveal = (envId: string, rowId: string) =>
    setRevealed((r) => {
      const next = new Set(r);
      const key = revealKey(envId, rowId);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const add = () => {
    const env = newEnvironment(`Environment ${environments.length + 1}`);
    onChange([...environments, env]);
    setSelectedId(env.id);
    setQuery("");
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

  const goToDuplicate = () => {
    const group = duplicates.groups[0];
    const last = group && selected?.vars[group.rows[group.rows.length - 1] - 1];
    if (!last) return;
    const input = document.querySelector<HTMLInputElement>(`[data-row-name="${last.id}"]`);
    input?.scrollIntoView?.({ block: "center" });
    input?.focus();
  };

  const firstGroup = duplicates.groups[0];
  const pills = (
    <>
      {dupCount > 0 && (
        <span className="dlg-pill danger">
          <AlertIcon size={11} />
          {plural(dupCount, "duplicate name")}
        </span>
      )}
      {missing > 0 && (
        <span className="dlg-pill warn">
          <AlertIcon size={11} />
          {plural(missing, "missing value")}
        </span>
      )}
    </>
  );

  return (
    <Modal label="Environments" onClose={onClose} className="dlg-modal envdlg">
      <div className="modal-head dlg-head">
        <h3>Environments</h3>
        {pills}
        <div className="dlg-head-actions">
          <button
            className="secondary"
            onClick={() => {
              // The Import dialog is the same one everywhere. It sits above the other dialogs, so close this one first.
              onClose();
              openImportDialog();
            }}
          >
            Import…
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>
      <div className="dlg-body" ref={body}>
        <aside className="dlg-side" aria-label="Environments">
          <div className="envdlg-search">
            <SearchIcon />
            <input className="dlg-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search environments" aria-label="Search environments" spellCheck={false} />
          </div>
          <div className="dlg-side-list">
            {shownEnvs.map((e) => {
              const color = e.color && e.color !== "none" ? ENV_COLOR_VARS[e.color] : undefined;
              return (
                <button key={e.id} className={`dlg-item${e.id === selectedId ? " active" : ""}`} onClick={() => setSelectedId(e.id)} aria-current={e.id === selectedId ? "true" : undefined} title={e.name || "(unnamed)"}>
                  <span className={`dlg-dot${color ? "" : " none"}`} style={color ? { background: color } : undefined} aria-hidden />
                  <span className="dlg-item-name">{e.name || "(unnamed)"}</span>
                  {e.isProduction === true && <span className="env-prod-badge">PROD</span>}
                </button>
              );
            })}
            {shownEnvs.length === 0 && environments.length > 0 && <p className="muted small envdlg-none">No matching environments</p>}
          </div>
          <button className="secondary dlg-side-foot" onClick={add}>
            + New environment
          </button>
        </aside>
        <section className="dlg-main" aria-label={selected ? `${selected.name || "(unnamed)"} details` : "Environment details"}>
          {selected ? (
            <>
              {mode === "this" && (
                <div className="dlg-section">
                  <div className="dlg-section-head">
                    <span className="dlg-label">Details</span>
                  </div>
                  <div className="dlg-field">
                    <label className="dlg-field-label" htmlFor="envdlg-name">
                      Name
                    </label>
                    <input id="envdlg-name" type="text" value={selected.name} onChange={(e) => update({ ...selected, name: e.target.value })} />
                    <button className="secondary" onClick={() => duplicate(selected)}>
                      Duplicate
                    </button>
                    <button className="secondary danger" onClick={() => remove(selected)}>
                      Delete
                    </button>
                  </div>
                  <div className="dlg-field envdlg-colour">
                    <span className="dlg-field-label" id="envdlg-colour-label">
                      Colour
                    </span>
                    <div className="envdlg-swatches" role="radiogroup" aria-labelledby="envdlg-colour-label">
                      {ENV_COLORS.map((c) => (
                        <button
                          key={c}
                          role="radio"
                          aria-checked={(selected.color ?? "none") === c}
                          aria-label={colorLabel(c)}
                          title={colorLabel(c)}
                          className={`env-swatch ${(selected.color ?? "none") === c ? "on" : ""} ${c === "none" ? "none" : ""}`}
                          style={c === "none" ? undefined : { background: ENV_COLOR_VARS[c as Exclude<EnvColor, "none">] }}
                          onClick={() => update({ ...selected, color: c })}
                        />
                      ))}
                    </div>
                    <span className="dlg-hint">The whole Send button takes this colour, and so do Run suite and Run.</span>
                  </div>
                  <label className="dlg-check">
                    <input type="checkbox" checked={selected.isProduction === true} onChange={(e) => update({ ...selected, isProduction: e.target.checked })} />
                    <span>
                      Production environment <span className="dlg-hint">Asks before a send or batch run goes here (About, Settings). You set this yourself; the name is not checked.</span>
                    </span>
                  </label>
                </div>
              )}
              <div className="dlg-section grow">
                <div className="dlg-section-head">
                  <span className="dlg-label">{mode === "compare" ? `Variables across ${plural(environments.length, "environment")}` : `Variables (${selected.vars.filter((v) => v.key.trim() !== "").length})`}</span>
                  {canCompare && (
                    <Segmented<View>
                      label="Variables view"
                      value={mode}
                      onChange={setView}
                      options={[
                        { value: "this", label: "This environment" },
                        { value: "compare", label: "Compare" },
                      ]}
                    />
                  )}
                </div>
                {mode === "this" ? (
                  <>
                    {firstGroup && (
                      <div className="dlg-banner danger" role="alert">
                        <AlertIcon size={14} />
                        <span className="dlg-banner-text">
                          <strong>Duplicate variable name.</strong> <code>{firstGroup.name}</code> appears on rows {joinRowNumbers(firstGroup.rows)}. Only the last one is used.
                        </span>
                        <button className="secondary" onClick={goToDuplicate}>
                          Go to row
                        </button>
                      </div>
                    )}
                    <EnvVarsTable envId={selected.id} rows={selected.vars} onChange={(vars) => update({ ...selected, vars })} duplicates={duplicates} revealed={revealed} onToggleReveal={toggleReveal} />
                    <p className="dlg-hint">
                      Use these anywhere in a request as {"{{name}}"}. In a batch run, a CSV column with the same name wins. Lock a value to mask it on screen and leave it out of exports. The eye shows one value in this environment until you close this dialog.
                    </p>
                  </>
                ) : (
                  <EnvCompare
                    environments={environments}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onEdit={(envId, rowId, value) => onChange(setVarValue(environments, envId, rowId, value))}
                    onAdd={(envId, name) => onChange(addMissingVar(environments, envId, name))}
                    revealed={revealed}
                    onToggleReveal={toggleReveal}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="muted">No environments yet. Add one to keep values like base URLs and tokens for Dev, Test and Prod in one place.</p>
          )}
        </section>
      </div>
      <div className="dlg-foot">
        <span className="muted small">Changes save automatically</span>
        {pills}
        <span className="spacer" />
        <button onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
