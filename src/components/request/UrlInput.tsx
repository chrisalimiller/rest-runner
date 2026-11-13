import { useCallback, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { looksLikeCurl } from "../../lib/curlImport";
import { splitPlaceholders } from "../../lib/requestSummary";
import { usePlaceholderHover } from "../variables/usePlaceholderHover";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "className"> & {
  value: string;
  className?: string;
  /**
   * Called with pasted text that looks like a curl command. Return true when it took the paste;
   * false (or no handler) lets the text go into the box as typed.
   */
  onPasteCurl?: (text: string) => boolean;
};

/**
 * A URL box that shows {{placeholders}} highlighted. The field itself does all the
 * typing, pasting and key handling; its text is drawn transparent and a copy of the
 * text with the placeholders marked sits behind it, scrolled in step with the field.
 *
 * It is a textarea so the whole URL can be seen while editing: unfocused it is one
 * line that scrolls sideways, focused it wraps and grows to show every line. A URL
 * never contains a line break, so Enter is swallowed and pasted breaks are removed.
 */
export function UrlInput({ value, className, onKeyDown, onMouseMove, onMouseLeave, onPaste, onPasteCurl, onChange, onFocus, onBlur, ...inputProps }: Props) {
  const hover = usePlaceholderHover(".url-var");
  const input = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const text = useRef<HTMLSpanElement>(null);

  const sync = useCallback(() => {
    if (input.current && text.current) text.current.style.transform = expanded ? "" : `translateX(${-input.current.scrollLeft}px)`;
  }, [expanded]);

  // Typing and pasting can scroll the input before or after React renders, so check again on the next frame too.
  const syncSoon = useCallback(() => {
    sync();
    requestAnimationFrame(sync);
  }, [sync]);

  useLayoutEffect(syncSoon, [value, syncSoon]);

  // Focused, the box is as tall as the wrapped text; otherwise it returns to the one-line height from CSS.
  // Wrapping depends on the width, so a window resize refits it too.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "";
      if (expanded) el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    el.scrollLeft = 0;
    if (!expanded) return;
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value, expanded]);

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
    <div ref={hover.root} className={`url-field ${expanded ? "expanded" : ""} ${hover.over ? "hover-var" : ""}`}>
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
      <textarea
        ref={input}
        {...inputProps}
        rows={1}
        wrap={expanded ? "soft" : "off"}
        value={value}
        className={`url-input ${className ?? ""}`.trim()}
        onChange={(e) => {
          if (/[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/[\r\n]+/g, "");
          onChange?.(e);
        }}
        onFocus={(e) => {
          setExpanded(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setExpanded(false);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
          if (!hover.onKeyDown(e)) onKeyDown?.(e);
        }}
        onPaste={(e) => {
          onPaste?.(e);
          const text = e.clipboardData?.getData("text") ?? "";
          if (!e.defaultPrevented && onPasteCurl && looksLikeCurl(text) && onPasteCurl(text)) e.preventDefault();
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
