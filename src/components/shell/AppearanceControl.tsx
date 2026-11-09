import { useRef, useState } from "react";
import { getThemePref, setThemePref, type ThemePref } from "../../lib/theme";
import "./shell.css";

const OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** Appearance: System, Light or Dark, as a radio group. Arrow keys move and choose, like the environment switch. */
export function AppearanceControl() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const groupRef = useRef<HTMLDivElement>(null);

  const choose = (next: ThemePref) => {
    setPref(next);
    setThemePref(next);
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
    <div className="appearance-control">
      <span className="appearance-label" id="appearance-label">
        Appearance
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="appearance-label" ref={groupRef} onKeyDown={onKeyDown}>
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
