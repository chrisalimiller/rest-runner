import { useState } from "react";

interface Props {
  label: string;
  value: number;
  onChange: (value: number) => void;
  presets: number[];
  min: number;
  max: number;
  /** How far the − and + buttons move the value. */
  step: number;
  /** Text for a preset button, e.g. "250 ms". */
  format?: (v: number) => string;
  /** Shown after the custom value, e.g. "ms". */
  unit?: string;
  disabled?: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A number setting with one-click presets and a last slot that takes any value. */
export function PresetField({ label, value, onChange, presets, min, max, step, format = String, unit, disabled }: Props) {
  // A non-empty text means the custom slot is the active one. It starts that way when the saved value is not a preset.
  const [text, setText] = useState(() => (presets.includes(value) ? "" : String(value)));
  const custom = text !== "";

  const set = (v: number) => {
    setText(String(v));
    onChange(v);
  };

  return (
    <div className="preset-field">
      <span id={`pf-${label}`}>{label}</span>
      <span className="seg" role="group" aria-labelledby={`pf-${label}`}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={!custom && value === p ? "on" : ""}
            aria-pressed={!custom && value === p}
            disabled={disabled}
            onClick={() => {
              setText("");
              onChange(p);
            }}
          >
            {format(p)}
          </button>
        ))}
        <span className={`seg-custom ${custom ? "on" : ""}`}>
          <button type="button" className="seg-step" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= min} onClick={() => set(clamp(value - step, min, max))}>
            −
          </button>
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            placeholder="Custom"
            aria-label={`Custom ${label.toLowerCase()}, ${min} to ${max}`}
            value={text}
            disabled={disabled}
            onChange={(e) => {
              const t = e.target.value;
              setText(t);
              const n = Math.round(Number(t));
              if (t !== "" && Number.isFinite(n)) onChange(clamp(n, min, max));
            }}
            onBlur={() => {
              if (text !== "") setText(String(value));
            }}
          />
          {unit && <span className="seg-unit">{unit}</span>}
          <button type="button" className="seg-step" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => set(clamp(value + step, min, max))}>
            +
          </button>
        </span>
      </span>
    </div>
  );
}
