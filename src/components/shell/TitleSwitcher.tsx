import { useEffect, useRef, useState } from "react";
import { useEscape } from "../useEscape";
import { ChevronDownIcon } from "./Icons";

export interface SwitcherItem {
  id: string;
  name: string;
  /** A short extra on the right, like the number of cases or steps. */
  detail?: string;
}

interface Props {
  /** "Suites", "Flows": names the list and its buttons. */
  noun: string;
  title: string;
  items: SwitcherItem[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport: (file: File) => void;
  /** Left out for a list that cannot be exported yet. */
  onExport?: () => void;
}

/** The title in the top bar as a button: click it for the list, with New, Import and Export, as in Requests. */
export function TitleSwitcher({ noun, title, items, activeId, onOpen, onNew, onImport, onExport }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="switcher" ref={wrap}>
      <div className={`switcher-btn ${open ? "open" : ""}`}>
        <button className="switcher-open title-switcher-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} title={`Switch ${noun.toLowerCase()}`}>
          <span className="topbar-title" title={title}>
            {title || "(unnamed)"}
          </span>
          <ChevronDownIcon />
        </button>
      </div>
      {open && (
        <div className="switcher-popover list-popover" role="dialog" aria-label={noun}>
          <div className="popover-head">
            <span className="section-title">{noun}</span>
            <span className="sidebar-actions">
              <button
                className="link-btn"
                onClick={() => {
                  setOpen(false);
                  onNew();
                }}
              >
                New
              </button>
              <label className="link-btn">
                Import
                <input
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) {
                      setOpen(false);
                      onImport(f);
                    }
                  }}
                />
              </label>
              {onExport && (
                <button
                  className="link-btn"
                  disabled={items.length === 0}
                  onClick={() => {
                    setOpen(false);
                    onExport();
                  }}
                >
                  Export
                </button>
              )}
            </span>
          </div>
          <div className="tree-scroll">
            {items.length === 0 && <p className="muted small pad">Nothing here yet. Use New.</p>}
            {items.map((it) => (
              <button
                key={it.id}
                className={`nav-row ${it.id === activeId ? "active" : ""}`}
                aria-current={it.id === activeId ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  onOpen(it.id);
                }}
              >
                <span className="nav-row-name">{it.name || "(unnamed)"}</span>
                {it.detail && <span className="nav-row-count">{it.detail}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
