import { useRef } from "react";
import { splitPlaceholders } from "../lib/requestSummary";
import type { Vars } from "../lib/template";
import { usePlaceholderHover } from "./variables/usePlaceholderHover";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** Values the placeholders can be filled from: a placeholder with one is drawn filled, one without as missing. */
  vars?: Vars;
};

/**
 * A text input that draws {{placeholders}} in their own style. The input's text is made transparent
 * and a copy of it with the placeholders marked sits under it, so typing, selecting and the caret work as usual.
 */
export function PlaceholderInput({ value, onChange, vars, className, onKeyDown, onMouseMove, onMouseLeave, ...rest }: InputProps) {
  const hover = usePlaceholderHover(".ph");
  const mirror = useRef<HTMLDivElement>(null);
  const marked = /\{\{|%7B%7B/i.test(value);
  const syncScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (mirror.current) mirror.current.scrollLeft = e.currentTarget.scrollLeft;
  };
  return (
    <div ref={hover.root} className={`ph-input ${marked ? "marked" : ""} ${hover.over ? "hover-var" : ""}`}>
      {marked && (
        <div className="ph-mirror" ref={mirror} aria-hidden>
          {splitPlaceholders(value, vars).map((p, i) =>
            p.placeholder ? (
              <span key={i} className={p.resolved === false ? "ph missing" : "ph"} data-name={p.name}>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
      )}
      <input {...rest} className={className} value={value} onChange={(e) => onChange(e.target.value)} 
        onScroll={syncScroll}
        onKeyUp={syncScroll}
        onSelect={syncScroll}
        onKeyDown={(e) => {
          if (!hover.onKeyDown(e)) onKeyDown?.(e);
        }}
        onMouseMove={(e) => {
          hover.onMouseMove(e);
          onMouseMove?.(e);
        }}
        onMouseLeave={(e) => {
          hover.onMouseLeave();
          onMouseLeave?.(e);
        }}
      />
    </div>
  );
}
