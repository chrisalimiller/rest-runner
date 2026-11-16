import { useRef, useState } from "react";
import { getDensityPref, setDensityPref, type DensityPref } from "../../lib/density";
import "./shell.css";

const OPTIONS: { id: DensityPref; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "default", label: "Default" },
  { id: "comfortable", label: "Comfortable" },
];

/** Display density: Compact, Default or Comfortable, as a radio group. Arrow keys move and choose, like Appearance. */
export function DensityControl() {
  const [pref, setPref] = useState<DensityPref>(getDensityPref);
  const groupRef = useRef<HTMLDivElement>(null);

  const choose = (next: DensityPref) => {
    setPref(next);
    setDensityPref(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = OPTIONS.findIndex((o) => o.id === pref);
    let next = i;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = OPTIONS.length - 1;
    else next = (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + OPTIONS.length) % OPTIONS.length;
    choose(OPTIONS[next].id);
    groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };

  return (
    <div className="density-control">
      <span className="density-label" id="density-label">
        Display density
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="density-label" ref={groupRef} onKeyDown={onKeyDown}>
        {OPTIONS.map((o) => {
          const on = o.id === pref;
          return (
            <button key={o.id} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={on ? "on" : ""} onClick={() => choose(o.id)}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
