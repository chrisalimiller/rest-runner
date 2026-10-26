import { useState } from "react";
import { destinations, type Collection, type Destination } from "../lib/collections";
import { useEscape } from "./useEscape";

const NEW_COLLECTION = "__new__";

function destKey(d: Destination): string {
  return `${d.collectionId}|${d.folderId ?? ""}`;
}

function parseKey(key: string): Destination {
  const [collectionId, folderId] = key.split("|");
  return { collectionId, folderId: folderId || null };
}

function SmallModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscape(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal small-modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Picks a collection or folder, with an option to type a new collection name. */
function DestinationPicker({
  collections,
  value,
  onChange,
  newName,
  onNewNameChange,
  allow = () => true,
}: {
  collections: Collection[];
  value: string;
  onChange: (key: string) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
  allow?: (d: Destination) => boolean;
}) {
  return (
    <>
      <label className="field">
        <span>Save to</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} size={Math.min(10, Math.max(4, destinations(collections).length + 1))}>
          {destinations(collections).map((d) => (
            <option key={destKey(d.dest)} value={destKey(d.dest)} disabled={!allow(d.dest)}>
              {`${"   ".repeat(d.depth)}${d.depth === 0 ? "▸ " : ""}${d.label.split(" / ").pop()}`}
            </option>
          ))}
          <option value={NEW_COLLECTION}>+ New collection…</option>
        </select>
      </label>
      {value === NEW_COLLECTION && (
        <label className="field">
          <span>Collection name</span>
          <input value={newName} onChange={(e) => onNewNameChange(e.target.value)} autoFocus placeholder="e.g. Users API" />
        </label>
      )}
    </>
  );
}

export type DestinationChoice = { dest: Destination } | { newCollection: string };

interface SaveProps {
  collections: Collection[];
  initialName: string;
  initialDest: Destination | null;
  onSave: (name: string, choice: DestinationChoice) => void;
  onClose: () => void;
}

/** Asks where to save a request that is not in a collection yet. */
export function SaveRequestDialog({ collections, initialName, initialDest, onSave, onClose }: SaveProps) {
  const first = initialDest ?? (collections[0] ? { collectionId: collections[0].id, folderId: null } : null);
  const [name, setName] = useState(initialName);
  const [target, setTarget] = useState(first ? destKey(first) : NEW_COLLECTION);
  const [newName, setNewName] = useState(collections.length === 0 ? "My requests" : "");
  const valid = name.trim() !== "" && (target !== NEW_COLLECTION || newName.trim() !== "");

  const submit = () => {
    if (!valid) return;
    onSave(name.trim(), target === NEW_COLLECTION ? { newCollection: newName.trim() } : { dest: parseKey(target) });
  };

  return (
    <SmallModal title="Save request" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>Request name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
        </label>
        <DestinationPicker collections={collections} value={target} onChange={setTarget} newName={newName} onNewNameChange={setNewName} />
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="send" disabled={!valid}>
            Save
          </button>
        </div>
      </form>
    </SmallModal>
  );
}

interface MoveProps {
  collections: Collection[];
  itemName: string;
  allow: (d: Destination) => boolean;
  onMove: (choice: DestinationChoice) => void;
  onClose: () => void;
}

/** Picks a new collection or folder for a request or folder. */
export function MoveDialog({ collections, itemName, allow, onMove, onClose }: MoveProps) {
  const firstAllowed = destinations(collections).find((d) => allow(d.dest));
  const [target, setTarget] = useState(firstAllowed ? destKey(firstAllowed.dest) : NEW_COLLECTION);
  const [newName, setNewName] = useState("");
  const valid = target === NEW_COLLECTION ? newName.trim() !== "" : allow(parseKey(target));
  return (
    <SmallModal title={`Move "${itemName}"`} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onMove(target === NEW_COLLECTION ? { newCollection: newName.trim() } : { dest: parseKey(target) });
        }}
      >
        <DestinationPicker collections={collections} value={target} onChange={setTarget} newName={newName} onNewNameChange={setNewName} allow={allow} />
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="send" disabled={!valid}>
            Move
          </button>
        </div>
      </form>
    </SmallModal>
  );
}

interface ExampleProps {
  requestName: string;
  initialName: string;
  responseLabel: string | null;
  onSave: (name: string, includeResponse: boolean) => void;
  onClose: () => void;
}

/** Names a new example and optionally keeps the last response as its sample. */
export function ExampleDialog({ requestName, initialName, responseLabel, onSave, onClose }: ExampleProps) {
  const [name, setName] = useState(initialName);
  const [includeResponse, setIncludeResponse] = useState(responseLabel !== null);
  return (
    <SmallModal title={`New example of "${requestName}"`} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim(), includeResponse && responseLabel !== null);
        }}
      >
        <p className="muted small">
          An example keeps a copy of the current URL, params, headers, body and auth under the same request, so you can keep sample
          payloads side by side.
        </p>
        <label className="field">
          <span>Example name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.target.select()} placeholder="e.g. Missing email" />
        </label>
        <label className="check">
          <input type="checkbox" checked={includeResponse} disabled={responseLabel === null} onChange={(e) => setIncludeResponse(e.target.checked)} />
          {responseLabel ? `Keep the last response (${responseLabel}) as a sample` : "No response to keep yet. Send the request first to save its response too."}
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="send" disabled={!name.trim()}>
            Save example
          </button>
        </div>
      </form>
    </SmallModal>
  );
}

interface ExportProps {
  /** How many environment variables are marked secret and have a value. */
  secretCount: number;
  onExport: (includeSecrets: boolean) => void;
  onClose: () => void;
}

/** Asks whether secret environment values go into the exported file. Leaving them out is the default. */
export function ExportWorkspaceDialog({ secretCount, onExport, onClose }: ExportProps) {
  const [include, setInclude] = useState(false);
  return (
    <SmallModal title="Export workspace" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          onExport(include);
        }}
      >
        <fieldset className="field radio-group">
          <legend>Include secret values?</legend>
          <p className="muted small">
            {secretCount} environment variable{secretCount === 1 ? " is" : "s are"} marked secret.
          </p>
          <label className="check">
            <input type="radio" name="include-secrets" checked={!include} onChange={() => setInclude(false)} autoFocus />
            Leave them out (recommended). Whoever imports the file sees which values to fill in.
          </label>
          <label className="check">
            <input type="radio" name="include-secrets" checked={include} onChange={() => setInclude(true)} />
            Include them. Anyone with the file can read them.
          </label>
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="send">
            Export
          </button>
        </div>
      </form>
    </SmallModal>
  );
}
