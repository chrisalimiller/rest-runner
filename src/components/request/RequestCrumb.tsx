import { useRef, useState } from "react";
import { PencilIcon } from "../shell/Icons";

interface Props {
  /** Collection, then folders, then (for an example) the request it belongs to. Empty when the request is not saved. */
  crumbs: string[];
  name: string;
  /** "Unsaved changes" or "Not saved" when the status should call attention to itself, otherwise null. */
  unsaved: string | null;
  /** Open the collections sidebar at a segment: the index into `crumbs`. */
  onReveal: (index: number) => void;
  renaming: boolean;
  onRenamingChange: (renaming: boolean) => void;
  onRename: (name: string) => void;
}

/**
 * Where the open request is saved, as a path above the URL bar: Collection › Folder › Request name.
 * Every segment opens the sidebar at that collection or folder; the name renames in place (double-click, the pencil, or F2).
 * The status sits at the right end.
 */
export function RequestCrumb({ crumbs, name, unsaved, onReveal, renaming, onRenamingChange, onRename }: Props) {
  const title = name || "Untitled request";
  return (
    <nav className="request-crumb" aria-label="Where this request is saved">
      <ol>
        {crumbs.length === 0 ? (
          <li className="crumb-unsaved-where">Not in a collection</li>
        ) : (
          crumbs.map((c, i) => (
            <li key={i}>
              <button className="crumb-seg" onClick={() => onReveal(i)} title={`Show ${c} in the sidebar`}>
                {c}
              </button>
              <span className="crumb-sep" aria-hidden>
                ›
              </span>
            </li>
          ))
        )}
        {renaming ? (
          <li className="crumb-cur editing">
            <RenameField
              initial={name}
              onDone={(next) => {
                onRenamingChange(false);
                if (next !== null && next.trim() !== "") onRename(next.trim());
              }}
            />
          </li>
        ) : (
          <li className="crumb-cur" aria-current="page">
            <span className="crumb-name" title={`${title}. Double-click or press F2 to rename.`} onDoubleClick={() => onRenamingChange(true)}>
              {title}
            </span>
            <button className="crumb-pencil" onClick={() => onRenamingChange(true)} aria-label="Rename request" title="Rename (F2)">
              <PencilIcon size={12} />
            </button>
          </li>
        )}
      </ol>
      <span className={`crumb-status ${unsaved ? "warn" : ""}`}>{unsaved ?? "Saved"}</span>
    </nav>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="crumb-rename"
      autoFocus
      value={value}
      size={Math.max(12, value.length + 1)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      aria-label="Request name"
    />
  );
}
