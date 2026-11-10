import { useMemo, useRef, useState } from "react";
import { Modal } from "./shell/Modal";
import { commitImport, type CommittedImport } from "../lib/importCommit";
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
const KIND_LABELS: Record<ImportItem["kind"], string> = { collection: "Collection", environment: "Environment", suite: "Test suite", flow: "Flow", certificates: "Certificates" };

function originNote(item: ImportItem): string | null {
  if (item.origin === "embedded") return "Variables found inside the collection. Not imported unless you check it.";
  if (item.origin === "globals") return "Postman globals apply to every request there. Not imported unless you check it.";
  return null;
}

type Done = { kind: "done"; result: CommittedImport } | { kind: "undone" };

/** The one Import dialog: drop files or paste text, review what was found, then import. Nothing is created unless checked. */
export function ImportDialog({ onClose, onChanged }: Props) {
  const [scans, setScans] = useState<ScannedFile[]>([]);
  const [choices, setChoices] = useState<ImportChoice[]>([]);
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

  const removeFile = (file: string, index: number) => {
    const scan = scans[index];
    const keys = new Set(scan.items.map((i) => i.key));
    setScans((s) => s.filter((_, i) => i !== index));
    setChoices((list) => list.filter((c) => !keys.has(c.item.key)));
    void file;
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

  if (done) {
    return (
      <Modal label="Import" onClose={onClose} className="import-modal">
        <div className="modal-head">
          <h3>{done.kind === "undone" ? "Import undone" : "Import finished"}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="import-body">
          {done.kind === "undone" ? (
            <p>Everything is back as it was before the import.</p>
          ) : (
            <>
              <p className="import-summary">
                {done.result.outcome.counts.added} added, {done.result.outcome.counts.merged} merged, {done.result.outcome.counts.replaced} replaced.
              </p>
              <ul className="import-lines">
                {done.result.outcome.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
                {done.result.certificates && <li>{done.result.certificates}</li>}
              </ul>
              {done.result.outcome.warnings.length > 0 && (
                <div className="import-warnings" role="status">
                  <strong>
                    {done.result.outcome.warnings.length} warning{done.result.outcome.warnings.length === 1 ? "" : "s"}
                  </strong>
                  <ul>
                    {done.result.outcome.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="import-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="import-foot">
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

  return (
    <Modal label="Import" onClose={onClose} className="import-modal">
      <div className="modal-head">
        <h3>Import</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="import-body">
        <div
          className={`import-drop ${dragging ? "over" : ""} ${choices.length > 0 ? "compact" : ""}`}
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
          <p className="muted small">
            Postman collections, environments and globals; Insomnia (v4 JSON) and Bruno exports; .env files; REST Runner files. The format is detected for you.
          </p>
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

        {scans.map((scan, i) =>
          scan.error ? (
            <div key={`${i}-${scan.file}`} className="import-file-error" role="alert">
              <span>
                <strong>{scan.file}</strong>: {scan.error}
              </span>
              <button className="link-btn" onClick={() => removeFile(scan.file, i)}>
                Remove
              </button>
            </div>
          ) : null,
        )}

        {choices.length > 0 && (
          <>
            <div className="import-review-head">
              <strong>Found in your files</strong>
              <span className="muted small">Nothing is created unless it is checked.</span>
            </div>
            {clashCount > 0 && outcome.unresolved > 0 && (
              <div className="import-clash-bar" role="status">
                <span>
                  {outcome.unresolved} name clash{outcome.unresolved === 1 ? "" : "es"} need{outcome.unresolved === 1 ? "s" : ""} an answer before you can import.
                </span>
                <span className="import-clash-all">
                  Apply to all:
                  {(["merge", "replace", "keep-both"] as Resolution[]).map((r) => (
                    <button key={r} className="secondary" onClick={() => setChoices((list) => applyToAllClashes(list, outcome.clashes, r))}>
                      {RESOLUTION_LABELS[r]}
                    </button>
                  ))}
                </span>
              </div>
            )}
            <ul className="import-items">
              {choices.map((c, i) => (
                <ItemRow
                  key={c.item.key}
                  choice={c}
                  clash={c.checked && outcome.clashes[i]}
                  takenName={uniqueName(c.name.trim() || c.item.name, new Set(namesOf(current, c.item.kind).map((n) => n.trim().toLowerCase())))}
                  onChange={(change) => patch(c.item.key, change)}
                />
              ))}
            </ul>
          </>
        )}
        {error && (
          <p className="import-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="import-foot">
        <span className="muted small">
          {choices.length === 0 ? "Add a file to begin." : `${checkedCount} of ${choices.length} selected${clashCount > 0 && outcome.unresolved > 0 ? `, ${outcome.unresolved} clash${outcome.unresolved === 1 ? "" : "es"} unresolved` : ""}`}
        </span>
        <span className="spacer" />
        <button className="secondary" onClick={onClose}>
          Cancel
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
    default:
      return [];
  }
}

function ItemRow({ choice, clash, takenName, onChange }: { choice: ImportChoice; clash: boolean; takenName: string; onChange: (c: Partial<ImportChoice>) => void }) {
  const { item } = choice;
  const note = originNote(item);
  const group = `clash-${item.key}`;
  const canRename = item.kind !== "certificates";
  return (
    <li className={`import-item ${choice.checked ? "on" : ""}`}>
      <div className="import-item-main">
        <input type="checkbox" checked={choice.checked} onChange={(e) => onChange({ checked: e.target.checked })} aria-label={`Import ${item.name}`} />
        <span className="import-kind">{KIND_LABELS[item.kind]}</span>
        {canRename ? (
          <input className="import-name" value={choice.name} onChange={(e) => onChange({ name: e.target.value })} aria-label={`Name for ${item.name}`} disabled={!choice.checked} />
        ) : (
          <span className="import-name-static">{item.name}</span>
        )}
        <span className="muted small import-detail">
          {item.detail} · {item.format} · {item.file}
        </span>
      </div>
      {note && <p className="muted small import-note">{note}</p>}
      {choice.checked && item.kind === "environment" && (
        <div className="import-options">
          <label>
            <input type="checkbox" checked={choice.isProduction} onChange={(e) => onChange({ isProduction: e.target.checked })} />
            Production environment
            <span className="muted small"> Asks before a send or run goes here.</span>
          </label>
          <label>
            <input type="checkbox" checked={choice.markSecrets} onChange={(e) => onChange({ markSecrets: e.target.checked })} />
            Mark secret-looking values
            <span className="muted small"> Names like token, key, secret, password. Postman secret variables are always secret.</span>
          </label>
        </div>
      )}
      {clash && (
        <fieldset className="import-clash" aria-invalid={choice.resolution === null}>
          <legend>
            {item.kind === "environment" ? "An environment" : item.kind === "collection" ? "A collection" : item.kind === "suite" ? "A test suite" : "A flow"} with this name already exists. What should happen?
          </legend>
          {resolutionsFor(item.kind).map((r) => (
            <label key={r} title={RESOLUTION_HINTS[r]}>
              <input type="radio" name={group} checked={choice.resolution === r} onChange={() => onChange({ resolution: r })} />
              {RESOLUTION_LABELS[r]}
              <span className="muted small"> {r === "keep-both" ? `as "${takenName}"` : RESOLUTION_HINTS[r]}</span>
            </label>
          ))}
          {choice.resolution === null && <p className="import-clash-needed">Choose one to continue.</p>}
        </fieldset>
      )}
      {choice.checked && item.warnings.length > 0 && (
        <ul className="import-item-warnings">
          {item.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
