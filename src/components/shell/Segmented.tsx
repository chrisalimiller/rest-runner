import { useRef, type KeyboardEvent } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

interface Props<T extends string> {
  options: readonly SegmentedOption<T>[];
  /** The chosen option, or null when nothing is chosen yet. */
  value: T | null;
  onChange: (value: T) => void;
  label: string;
}

/** A radio group drawn as joined buttons. Arrow keys move and choose; Tab leaves the group. */
export function Segmented<T extends string>({ options, value, onChange, label }: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const focusable = value !== null && options.some((o) => o.value === value) ? value : options[0]?.value;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[e.key];
    if (!step) return;
    e.preventDefault();
    const at = Math.max(0, options.findIndex((o) => o.value === (value ?? focusable)));
    const next = options[(at + step + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  };

  return (
    <div className="dlg-seg" role="radiogroup" aria-label={label} ref={root} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          tabIndex={o.value === focusable ? 0 : -1}
          className={o.value === value ? "on" : ""}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
