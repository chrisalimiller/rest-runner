import { useEffect, useRef, useState } from "react";
import { canFollow, filterStepGroups, NODE_TYPE_LABELS } from "../../lib/flows/flows";
import type { FlowNodeType } from "../../lib/flows/types";
import { useEscape } from "../useEscape";

interface Props {
  /** Screen position of the "+" the picker opened from. */
  anchor: { x: number; y: number };
  onPick: (type: FlowNodeType) => void;
  onClose: () => void;
}

const WIDTH = 220;

/** A small grouped list of the steps that can follow, with type-to-filter. */
export function StepPicker({ anchor, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onClose]);

  const groups = filterStepGroups(query)
    .map((g) => ({ ...g, types: g.types.filter(canFollow) }))
    .filter((g) => g.types.length > 0);
  const first = groups[0]?.types[0];
  const left = Math.max(8, Math.min(anchor.x + 12, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(anchor.y - 12, window.innerHeight - 340));

  return (
    <div ref={box} className="step-picker" style={{ left, top, width: WIDTH }} role="dialog" aria-label="Add a step">
      <input
        ref={input}
        className="step-picker-search"
        value={query}
        placeholder="Find a step…"
        aria-label="Find a step"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && first) onPick(first);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            box.current?.querySelector<HTMLButtonElement>(".step-picker-item")?.focus();
          }
        }}
      />
      <div className="step-picker-list">
        {groups.map((g) => (
          <div key={g.label} role="group" aria-label={g.label}>
            <div className="step-picker-group">{g.label}</div>
            {g.types.map((t) => (
              <button
                key={t}
                className={`step-picker-item type-${t}`}
                onClick={() => onPick(t)}
                onKeyDown={(e) => {
                  const items = [...(box.current?.querySelectorAll<HTMLButtonElement>(".step-picker-item") ?? [])];
                  const i = items.indexOf(e.currentTarget);
                  if (e.key === "ArrowDown") (items[i + 1] ?? items[i]).focus();
                  if (e.key === "ArrowUp") (i === 0 ? input.current : items[i - 1])?.focus();
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") e.preventDefault();
                }}
              >
                <span className="palette-swatch" aria-hidden />
                {NODE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="muted small step-picker-empty">No step matches.</p>}
      </div>
    </div>
  );
}
