import { useEffect, useRef, useState } from "react";
import { useEscape } from "../useEscape";
import { MoreIcon } from "./Icons";
import "./shell.css";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** Draws a divider above this item. */
  separated?: boolean;
}

interface Props {
  items: MenuItem[];
  /** Accessible name for the ⋯ button. */
  label?: string;
  disabled?: boolean;
}

/** A ⋯ button that opens a menu. Closes with Escape or a click elsewhere; arrow keys, Home and End move between items. */
export function OverflowMenu({ items, label = "More actions", disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (e.key === "ArrowDown") to = (i + 1) % buttons.length;
    else if (e.key === "ArrowUp") to = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = buttons.length - 1;
    else if (e.key === "Tab") setOpen(false);
    if (to >= 0) {
      e.preventDefault();
      buttons[to].focus();
    }
  };

  return (
    <span className="overflow-menu">
      <button
        ref={button}
        className="icon-btn overflow-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="overflow-popover" role="menu" aria-label={label} ref={menu} onKeyDown={onKeyDown} style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }}>
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={`overflow-item ${item.danger ? "danger" : ""} ${item.separated ? "separated" : ""}`}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <span className="overflow-icon" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
