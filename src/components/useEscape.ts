import { useEffect, useRef } from "react";

/** Open overlays, oldest first. Only the last one reacts to Escape. */
const stack: symbol[] = [];

/**
 * Closes an overlay (modal, sheet or side panel) with Escape.
 * Only the most recently opened overlay that uses this hook responds, and a key press
 * already handled by something inside it (an editor's autocomplete, an inline rename)
 * is left alone. When the overlay closes, focus goes back to where it was before it opened.
 */
export function useEscape(onEscape: () => void, active = true): void {
  const callback = useRef(onEscape);
  callback.current = onEscape;
  // Taken while rendering: an `autoFocus` inside the overlay moves focus during the commit, before any effect runs.
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (!active || opener.current === undefined) {
    const el = typeof document === "undefined" || typeof HTMLElement === "undefined" ? null : document.activeElement;
    opener.current = el && el !== document.body ? (el as HTMLElement) : null;
  }

  useEffect(() => {
    if (!active) return;
    const id = Symbol("overlay");
    stack.push(id);
    const before = opener.current;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (stack[stack.length - 1] !== id) return;
      e.preventDefault();
      callback.current();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      // Back to the opener; if it is gone or never existed (a shortcut opened it), the URL box.
      if (before && before.isConnected) before.focus();
      else if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>(".url-input")?.focus({ preventScroll: true });
    };
  }, [active]);
}
