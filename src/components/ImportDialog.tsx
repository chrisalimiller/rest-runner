import { useMemo, useRef, useState } from "react";
import { Modal } from "./shell/Modal";
import { AlertIcon, CheckIcon } from "./shell/Icons";
import { RevealButton } from "./shell/RevealButton";
import { Segmented } from "./shell/Segmented";
import { commitImport, type CommittedImport } from "../lib/importCommit";
import { revealKey } from "../lib/envVars";
import { ENV_COLOR_VARS } from "../lib/environments";
import { markSecretLooking } from "../lib/importFormats";
import {
  applyToAllClashes,
  canImport,
  computeImport,
  defaultChoice,
  resolutionsFor,
  scanText,
  uniqueName,
  type ImportChoice,
  type ImportItem,
  type Resolution,
  type ScannedFile,
} from "../lib/importFlow";
import { readWorkspace } from "../lib/workspaceStore";
import "./dlg.css";
import "./importDialog.css";

interface Props {
  onClose: () => void;
  /** Saved data changed (or an import was undone): other modes read storage again. */
  onChanged: () => void;
}

const RESOLUTION_LABELS: Record<Resolution, string> = { merge: "Merge", replace: "Replace", "keep-both": "Keep both" };
const RESOLUTION_HINTS: Record<Resolution, string> = {
  merge: "Add what is new and update what matches",
  replace: "Swap the existing one for the imported one",
  "keep-both": "Add the imported one under a new name",
};
const KIND_LABELS: Record<ImportItem["kind"], string> = { collection: "Collection", environment: "Environment", suite: "Test suite", flow: "Flow", tool: "Tool", certificates: "Certificates" };
const KIND_ARTICLE: Record<ImportItem["kind"], string> = { collection: "A collection", environment: "An environment", suite: "A test suite", flow: "A flow", tool: "A tool", certificates: "Certificates" };
const KIND_NOUN: Record<ImportItem["kind"], string> = { collection: "collection", environment: "environment", suite: "test suite", flow: "flow", tool: "tool", certificates: "certificates" };

const STEPS = ["Add files", "Review", "Resolve clashes", "Done"] as const;

function originNote(item: ImportItem): string | null {
  if (item.origin === "embedded") return "Variables found inside the collection. Not imported unless you check it.";
  if (item.origin === "globals") return "Postman globals apply to every request there. Not imported unless you check it.";
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Done = { kind: "done"; result: CommittedImport } | { kind: "undone" };
type Stage = "add" | "review";

/** The one Import dialog: drop files or paste text, review what was found, then import. Nothing is created unless checked. */
export function ImportDialog({ onClose, onChanged }: Props) {
  const [scans, setScans] = useState<ScannedFile[]>([]);
  const [choices, setChoices] = useState<ImportChoice[]>([]);
  const [stage, setStage] = useState<Stage>("add");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [applyAll, setApplyAll] = useState(false);
  // Secret values that are showing in the preview, as `itemKey:rowId`. Not saved.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const counter = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  // Review against what is saved now, read when the dialog opens. The import itself re-reads it.
  const current = useMemo(() => readWorkspace(), []);
  const outcome = useMemo(() => computeImport(current, choices), [current, choices]);
  const ready = canImport(choices, outcome);
  const checkedCount = choices.filter((c) => c.checked).length;
  const clashCount = outcome.clashes.filter((c, i) => c && choices[i].checked).length;
  const unresolved = clashCount > 0 ? outcome.unresolved : 0;

  const addText = (name: string, text: string) => {
    counter.current += 1;
    const scan = scanText(name, text, `${counter.current}:${name}`);
    setScans((s) => [...s, scan]);
    setChoices((c) => [...c, ...scan.items.map(defaultChoice)]);
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      try {
        addText(f.name, await f.text());
      } catch (e) {
        setScans((s) => [...s, { file: f.name, format: "", items: [], error: e instanceof Error ? e.message : String(e) }]);
      }
    }
  };

  const patch = (key: string, change: Partial<ImportChoice>) => setChoices((list) => list.map((c) => (c.item.key === key ? { ...c, ...change } : c)));

  const removeFile = (index: number) => {
    const scan = scans[index];
    const keys = new Set(scan.items.map((i) => i.key));
    setScans((s) => s.filter((_, i) => i !== index));
    setChoices((list) => list.filter((c) => !keys.has(c.item.key)));
  };

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await commitImport(choices);
      onChanged();
      setDone({ kind: "done", result });
    } catch (e) {
      setError(`Could not import: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
    } finally {
      setBusy(false);
    }
  };

  const undo = (result: CommittedImport) => {
    const ok = result.undo();
    onChanged();
    if (ok) setDone({ kind: "undone" });
    else setError("Could not restore everything: local storage refused the write.");
  };

  const toggleReveal = (itemKey: string, rowId: string) =>
    setRevealed((r) => {
      const next = new Set(r);
      const key = revealKey(itemKey, rowId);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const stepper = (active: number, finished: boolean) => (
    <ol className="imp-stepper" aria-label="Import steps">
      {STEPS.map((label, i) => {
        // "Resolve clashes" is part of Review: it is current while answers are missing and finished once they are in.
        const complete = finished || i < active || (i === 2 && active === 1 && unresolved === 0);
        const on = !finished && (i === active || (i === 2 && active === 1 && unresolved > 0));
        return (
          <li key={label} className={`imp-step${on ? " on" : ""}${complete ? " done" : ""}`} aria-current={on ? "step" : undefined}>
            <span className="imp-step-mark" aria-hidden>
              {complete ? <CheckIcon size={10} /> : i + 1}
            </span>
            <span>{label}</span>
            {complete && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );

  const closeButton = (
    <button className="icon-btn" onClick={onClose} aria-label="Close">
      ×
    </button>
  );

  // ---- Step 4: done ----
  if (done) {
    return (
      <Modal label="Import" onClose={onClose} className="dlg-modal import-modal">
        <div className="modal-head dlg-head">
          <h3>{done.kind === "undone" ? "Import undone" : "Import finished"}</h3>
          {closeButton}
        </div>
        <div className="dlg-body">
          <aside className="dlg-side" aria-label="Progress">
            {stepper(3, true)}
          </aside>
          <section className="dlg-main">
            {done.kind === "undone" ? (
              <p>Everything is back as it was before the import.</p>
            ) : (
              <>
                <div className="dlg-section">
                  <div className="dlg-section-head">
                    <span className="dlg-label">
                      {done.result.outcome.counts.added} added, {done.result.outcome.counts.merged} merged, {done.result.outcome.counts.replaced} replaced
                    </span>
                  </div>
                  <ul className="imp-result" aria-label="What was imported">
                    {done.result.outcome.lines.map((l, i) => (
                      <li key={i}>
                        <span className="imp-tick" aria-hidden>
                          <CheckIcon size={14} />
                        </span>
                        {l}
                      </li>
                    ))}
                    {done.result.certificates && (
                      <li>
                        <span className="imp-tick" aria-hidden>
                          <CheckIcon size={14} />
                        </span>
                        {done.result.certificates}
                      </li>
                    )}
                  </ul>
                </div>
                {done.result.outcome.warnings.length > 0 && (
                  <div className="dlg-banner" role="status">
                    <AlertIcon size={14} />
                    <div className="dlg-banner-text">
                      <strong>{plural(done.result.outcome.warnings.length, "warning")}</strong>
                      <ul className="imp-warn-list">
                        {done.result.outcome.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
            {error && (
              <p className="import-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
        <div className="dlg-foot">
          {done.kind === "done" && (
            <button className="secondary" onClick={() => undo(done.result)}>
              Undo import
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  const fileErrors = scans.filter((s) => s.error).length;
  const selectedIndex = Math.max(0, choices.findIndex((c) => c.item.key === selectedKey));
  const selectedChoice = choices[selectedIndex] ?? null;

  const header = (
    <div className="modal-head dlg-head">
      <h3>Import</h3>
      {stage === "review" && unresolved > 0 && (
        <span className="dlg-pill danger">
          <AlertIcon size={11} />
          {plural(unresolved, "clash", "clashes")} to resolve
        </span>
      )}
      {closeButton}
    </div>
  );

  // ---- Step 1: add files ----
  if (stage === "add") {
    return (
      <Modal label="Import" onClose={onClose} className="dlg-modal import-modal">
        {header}
        <div className="dlg-body">
          <aside className="dlg-side" aria-label="Progress">
            {stepper(0, false)}
          </aside>
          <section className="dlg-main">
            <div
              className={`import-drop ${dragging ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles(e.dataTransfer.files);
              }}
            >
              <p className="import-drop-title">Drop files here</p>
              <p className="dlg-hint">Postman collections, environments and globals; Insomnia (v4 JSON) and Bruno exports; .env files; REST Runner files. The format is detected for you.</p>
              <div className="import-drop-actions">
                <button className="secondary" onClick={() => input.current?.click()}>
                  Choose files…
                </button>
                <button className="secondary" onClick={() => setPaste((p) => !p)} aria-expanded={paste}>
                  Paste text…
                </button>
              </div>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {paste && (
              <div className="import-paste">
                <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste exported JSON or the contents of a .env file" aria-label="Pasted text" rows={5} spellCheck={false} />
                <button
                  className="secondary"
                  disabled={pasted.trim() === ""}
                  onClick={() => {
                    addText("Pasted text", pasted);
                    setPasted("");
                    setPaste(false);
                  }}
                >
                  Add pasted text
                </button>
              </div>
            )}
            {scans.length > 0 && (
              <div className="dlg-section">
                <div className="dlg-section-head">
                  <span className="dlg-label">Added ({scans.length})</span>
                </div>
                <ul className="imp-files">
                  {scans.map((scan, i) => (
                    <li key={`${i}-${scan.file}`} className={scan.error ? "bad" : ""} role={scan.error ? "alert" : undefined}>
                      <span className="imp-file-name" title={scan.file}>
                        {scan.file}
                      </span>
                      {scan.error ? (
                        <span className="imp-file-err">{scan.error}</span>
                      ) : (
                        <span className={`dlg-pill${scan.format ? "" : " warn"}`}>{scan.format || "Not recognised"}</span>
                      )}
                      {!scan.error && <span className="imp-file-count">{plural(scan.items.length, "item")}</span>}
                      <button className="link-btn" onClick={() => removeFile(i)} aria-label={`Remove ${scan.file}`}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
        <div className="dlg-foot">
          <span className="muted small">{choices.length === 0 ? (fileErrors > 0 ? "Nothing importable yet." : "Add a file to begin.") : `${plural(choices.length, "item")} found`}</span>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            disabled={choices.length === 0}
            onClick={() => {
              setSelectedKey((k) => k ?? choices[0]?.item.key ?? null);
              setStage("review");
            }}
          >
            Review
          </button>
        </div>
      </Modal>
    );
  }

  // ---- Steps 2 and 3: review and resolve clashes ----
  return (
    <Modal label="Import" onClose={onClose} className="dlg-modal import-modal">
      {header}
      <div className="dlg-body">
        <aside className="dlg-side" aria-label="Found in your files">
          {stepper(1, false)}
          <div className="dlg-label imp-found-label">Found ({choices.length})</div>
          <div className="dlg-side-list">
            {choices.map((c, i) => {
              const env = c.item.environment;
              const color = env?.color && env.color !== "none" ? ENV_COLOR_VARS[env.color] : undefined;
              const clash = c.checked && outcome.clashes[i];
              const name = c.name.trim() || c.item.name;
              return (
                <div key={c.item.key} className={`dlg-item imp-item${i === selectedIndex ? " active" : ""}`}>
                  <input type="checkbox" checked={c.checked} onChange={(e) => patch(c.item.key, { checked: e.target.checked })} aria-label={`Import ${c.item.name}`} />
                  <button className="imp-item-btn" onClick={() => setSelectedKey(c.item.key)} aria-current={i === selectedIndex ? "true" : undefined} title={`${KIND_LABELS[c.item.kind]}: ${name}`}>
                    <span className={`dlg-dot${color ? "" : " none"}`} style={color ? { background: color } : undefined} aria-hidden />
                    <span className="dlg-item-name">{name}</span>
                    {clash ? <span className="dlg-pill danger">Clash</span> : <span className="dlg-item-count">{c.item.detail.split(" ")[0]}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        <section className="dlg-main" aria-label={selectedChoice ? `${selectedChoice.item.name} details` : "Details"}>
          {selectedChoice && (
            <ItemDetail
              choice={selectedChoice}
              clash={selectedChoice.checked && outcome.clashes[selectedIndex]}
              takenName={uniqueName(selectedChoice.name.trim() || selectedChoice.item.name, new Set(namesOf(current, selectedChoice.item.kind).map((n) => n.trim().toLowerCase())))}
              onChange={(change) => patch(selectedChoice.item.key, change)}
              revealed={revealed}
              onToggleReveal={toggleReveal}
            />
          )}
          {error && (
            <p className="import-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      <div className="dlg-foot">
        {unresolved > 0 ? (
          <span className="dlg-pill danger">
            <AlertIcon size={11} />
            {plural(unresolved, "clash", "clashes")} to resolve
          </span>
        ) : (
          <span className="muted small">{`${checkedCount} of ${choices.length} selected`}</span>
        )}
        {clashCount > 0 && (
          <span className="imp-apply-all">
            <button className="secondary" onClick={() => setApplyAll((a) => !a)} aria-expanded={applyAll}>
              Apply one answer to all
            </button>
            {applyAll && (
              <Segmented<Resolution>
                label="Answer for every clash"
                value={null}
                options={(["merge", "replace", "keep-both"] as Resolution[]).map((r) => ({ value: r, label: RESOLUTION_LABELS[r], title: RESOLUTION_HINTS[r] }))}
                onChange={(r) => {
                  setChoices((list) => applyToAllClashes(list, outcome.clashes, r));
                  setApplyAll(false);
                }}
              />
            )}
          </span>
        )}
        <span className="spacer" />
        <button className="secondary" onClick={() => setStage("add")}>
          Back
        </button>
        <button
          disabled={!ready || busy}
          onClick={() => void doImport()}
          title={ready ? undefined : checkedCount === 0 ? "Check something to import" : "Answer every name clash first"}
        >
          {busy ? "Importing…" : `Import${checkedCount > 0 ? ` ${checkedCount}` : ""}`}
        </button>
      </div>
    </Modal>
  );
}

function namesOf(ws: ReturnType<typeof readWorkspace>, kind: ImportItem["kind"]): string[] {
  switch (kind) {
    case "collection":
      return ws.collections.map((c) => c.name);
    case "environment":
      return ws.environments.map((c) => c.name);
    case "suite":
      return ws.suites.map((c) => c.name);
    case "flow":
      return ws.flows.map((c) => c.name);
    case "tool":
      return ws.tools.map((c) => c.name);
    default:
      return [];
  }
}

interface DetailProps {
  choice: ImportChoice;
  clash: boolean;
  takenName: string;
  onChange: (c: Partial<ImportChoice>) => void;
  revealed: ReadonlySet<string>;
  onToggleReveal: (itemKey: string, rowId: string) => void;
}

function ItemDetail({ choice, clash, takenName, onChange, revealed, onToggleReveal }: DetailProps) {
  const { item } = choice;
  const note = originNote(item);
  const canRename = item.kind !== "certificates";
  const wanted = choice.name.trim() || item.name;
  // What the variables will look like after import, so the Secret column matches the "Mark secret-looking values" box.
  const vars = useMemo(() => {
    if (!item.environment) return [];
    const env = choice.markSecrets ? markSecretLooking(item.environment) : item.environment;
    return env.vars.filter((v) => v.key.trim() !== "");
  }, [item.environment, choice.markSecrets]);

  return (
    <>
      {clash && (
        <div className="dlg-banner danger" role="alert">
          <AlertIcon size={14} />
          <span className="dlg-banner-text">
            <strong>
              {KIND_ARTICLE[item.kind]} named {wanted} already exists.
            </strong>{" "}
            Choose what to do.
          </span>
        </div>
      )}
      <div className="dlg-section">
        <div className="dlg-section-head">
          <span className="dlg-label">Details</span>
          <span className="dlg-pill">{KIND_LABELS[item.kind]}</span>
        </div>
        <div className="dlg-field">
          <label className="dlg-field-label" htmlFor="imp-name">
            Name
          </label>
          {canRename ? (
            <input id="imp-name" type="text" value={choice.name} onChange={(e) => onChange({ name: e.target.value })} disabled={!choice.checked} />
          ) : (
            <span className="dlg-static">{item.name}</span>
          )}
        </div>
        {clash && (
          <div className="dlg-field">
            <span className="dlg-field-label" id="imp-exists-label">
              If it exists
            </span>
            <Segmented<Resolution>
              label={`If a ${KIND_NOUN[item.kind]} with this name exists`}
              value={choice.resolution}
              onChange={(resolution) => onChange({ resolution })}
              options={resolutionsFor(item.kind).map((r) => ({ value: r, label: RESOLUTION_LABELS[r], title: RESOLUTION_HINTS[r] }))}
            />
            <span className={choice.resolution === null ? "imp-needed" : "dlg-hint"}>
              {choice.resolution === null ? "Nothing is chosen yet." : choice.resolution === "keep-both" ? `Added as “${takenName}”.` : RESOLUTION_HINTS[choice.resolution]}
            </span>
          </div>
        )}
        {item.kind === "environment" && (
          <div className="imp-checks">
            <label className="dlg-check">
              <input type="checkbox" checked={choice.isProduction} disabled={!choice.checked} onChange={(e) => onChange({ isProduction: e.target.checked })} />
              <span>
                Production environment <span className="dlg-hint">Asks before a send or run goes here.</span>
              </span>
            </label>
            <label className="dlg-check">
              <input type="checkbox" checked={choice.markSecrets} disabled={!choice.checked} onChange={(e) => onChange({ markSecrets: e.target.checked })} />
              <span>
                Mark secret-looking values <span className="dlg-hint">Names like token, key, secret, password. Postman secret variables are always secret.</span>
              </span>
            </label>
          </div>
        )}
        <p className="dlg-hint imp-source">
          {item.detail} · {item.format} · {item.file}
          {!choice.checked && " · Not imported unless you check it in the list."}
        </p>
        {note && <p className="dlg-hint">{note}</p>}
      </div>
      {choice.checked && item.warnings.length > 0 && (
        <div className="dlg-banner" role="status">
          <AlertIcon size={14} />
          <ul className="imp-warn-list dlg-banner-text">
            {item.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {item.kind === "environment" && (
        <div className="dlg-section grow">
          <div className="dlg-section-head">
            <span className="dlg-label">Variables ({vars.length})</span>
          </div>
          <div className="dlg-scroll">
            <table className="dlg-table">
              <thead>
                <tr>
                  <th style={{ width: "34%" }}>Variable</th>
                  <th>Value</th>
                  <th className="col-secret">Secret</th>
                  <th className="col-show">Show</th>
                </tr>
              </thead>
              <tbody>
                {vars.map((v) => {
                  const shown = revealed.has(revealKey(item.key, v.id));
                  return (
                    <tr key={v.id}>
                      <td>
                        <span className="dlg-static mono" title={v.key}>
                          {v.key}
                        </span>
                      </td>
                      <td>
                        <span className="dlg-static mono" title={v.secret && !shown ? undefined : v.value}>
                          {v.secret && !shown ? "••••••••" : v.value}
                        </span>
                      </td>
                      <td className="col-secret">{v.secret ? "Yes" : "–"}</td>
                      <td className="col-show">{v.secret && <RevealButton shown={shown} onToggle={() => onToggleReveal(item.key, v.id)} subject={v.key} />}</td>
                    </tr>
                  );
                })}
                {vars.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No variables.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
