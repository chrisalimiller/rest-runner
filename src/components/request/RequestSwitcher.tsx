import { useEffect, useRef, useState } from "react";
import type { HttpMethod } from "../../lib/types";
import { ChevronDownIcon } from "../shell/Icons";

interface Props {
  crumbs: string[];
  method: HttpMethod;
  name: string;
  isExample: boolean;
  /** "Unsaved changes" or "Not saved" when the dot should show, otherwise null. */
  unsaved: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renaming: boolean;
  onRenamingChange: (renaming: boolean) => void;
  onRename: (name: string) => void;
  /** The popover: collections tree and its links. */
  children: React.ReactNode;
}

/**
 * The top-bar button that shows where the open request lives and opens the collections
 * popover. Clicking the name (or F2) renames the request in place.
 */
export function RequestSwitcher(props: Props) {
  const { open, onOpenChange } = props;
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The tree's own menus render inside the popover; dialogs render elsewhere and close it.
      if (wrapRef.current && !wrapRef.current.contains(target)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".menu")) onOpenChange(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="switcher" ref={wrapRef}>
      <div className={`switcher-btn ${open ? "open" : ""}`}>
        <button
          className="switcher-open"
          onClick={() => onOpenChange(!open)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={props.crumbs.length ? `${props.crumbs.join(" › ")} · open collections` : "Open collections"}
        >
          {props.crumbs.map((c, i) => (
            <span key={i} className={`switcher-crumb ${i === props.crumbs.length - 1 ? "last" : ""}`}>
              {c}
              <span className="crumb-sep" aria-hidden>
                ›
              </span>
            </span>
          ))}
          <span className={`method m-${props.method.toLowerCase()}`}>{props.method}</span>
          {props.isExample && <span className="chip example-chip">Example</span>}
        </button>
        {props.renaming ? (
          <RenameField
            initial={props.name}
            onDone={(name) => {
              props.onRenamingChange(false);
              if (name !== null && name.trim() !== "") props.onRename(name.trim());
            }}
          />
        ) : (
          <button className="switcher-name" onClick={() => props.onRenamingChange(true)} title="Rename (F2)">
            {props.name || "Untitled request"}
          </button>
        )}
        {props.unsaved && <span className="unsaved-dot" title={props.unsaved} aria-label={props.unsaved} role="img" />}
        <button className="switcher-chevron" onClick={() => onOpenChange(!open)} aria-label="Open collections" tabIndex={-1}>
          <ChevronDownIcon />
        </button>
      </div>
      {open && (
        <div className="switcher-popover" role="dialog" aria-label="Collections">
          {props.children}
        </div>
      )}
    </div>
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
      className="switcher-rename"
      autoFocus
      value={value}
      size={Math.max(12, value.length + 1)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(null);
      }}
      aria-label="Request name"
    />
  );
}
