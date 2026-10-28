import { useCallback, useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { splitPlaceholders } from "../../lib/requestSummary";
import { usePlaceholderHover } from "../variables/usePlaceholderHover";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "className"> & {
  value: string;
  className?: string;
};

/**
 * A plain text input that shows {{placeholders}} highlighted. The input itself
 * does all the typing, pasting and key handling; its text is drawn transparent
 * and a copy of the text with the placeholders marked sits behind it, scrolled
 * in step with the input.
 */
export function UrlInput({ value, className, onKeyDown, onMouseMove, onMouseLeave, ...inputProps }: Props) {
  const hover = usePlaceholderHover(".url-var");
  const input = useRef<HTMLInputElement>(null);
  const text = useRef<HTMLSpanElement>(null);

  const sync = useCallback(() => {
    if (input.current && text.current) text.current.style.transform = `translateX(${-input.current.scrollLeft}px)`;
  }, []);

  // Typing and pasting can scroll the input before or after React renders, so check again on the next frame too.
  const syncSoon = useCallback(() => {
    sync();
    requestAnimationFrame(sync);
  }, [sync]);

  useLayoutEffect(syncSoon, [value, syncSoon]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const events = ["scroll", "select", "keydown", "keyup", "mousedown", "mousemove", "mouseup", "focus", "blur"];
    for (const e of events) el.addEventListener(e, syncSoon);
    window.addEventListener("resize", syncSoon);
    return () => {
      for (const e of events) el.removeEventListener(e, syncSoon);
      window.removeEventListener("resize", syncSoon);
    };
  }, [syncSoon]);

  return (
    <div ref={hover.root} className={`url-field ${hover.over ? "hover-var" : ""}`}>
      <div className="url-mirror" aria-hidden>
        <span ref={text} className="url-mirror-text">
          {splitPlaceholders(value).map((p, i) =>
            p.placeholder ? (
              <span key={i} className="url-var" data-name={p.name}>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </span>
      </div>
      <input
        ref={input}
        {...inputProps}
        value={value}
        className={`url-input ${className ?? ""}`.trim()}
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
