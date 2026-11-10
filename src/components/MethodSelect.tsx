import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { moveIndex, typeAheadIndex } from "../lib/listbox";

type Props<T extends string> = {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  "aria-label"?: string;
  className?: string;
};

/** Accessible dropdown for HTTP methods; each option is drawn in its method color (.m-get etc). */
export function MethodSelect<T extends string>({ value, options, onChange, className, ...rest }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const cls = (m: string) => `m-${m.toLowerCase()}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function show() {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  }
  function choose(i: number) {
    onChange(options[i]);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) show();
      else choose(active);
      return;
    }
    const next = moveIndex(open ? active : options.indexOf(value), e.key, options.length);
    if (next !== null) {
      e.preventDefault();
      if (open) setActive(next);
      else show();
      return;
    }
    if (e.key.length === 1) {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at > 700 ? e.key : t.text + e.key;
      t.at = now;
      const from = open ? active : options.indexOf(value);
      const i = typeAheadIndex(options, from, t.text);
      if (i >= 0) {
        if (open) setActive(i);
        else onChange(options[i]);
      }
    }
  }

  return (
    <div ref={root} className={`method-dropdown ${className ?? ""}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-label={rest["aria-label"]}
        className={`method-select method-trigger ${cls(value)}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span>{value}</span>
        <span className="method-caret" aria-hidden />
      </button>
      {open && (
        <ul id={`${id}-list`} role="listbox" className="method-list" aria-label={rest["aria-label"]}>
          {options.map((m, i) => (
            <li
              key={m}
              id={`${id}-${i}`}
              role="option"
              aria-selected={m === value}
              className={`method-option ${cls(m)}${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
