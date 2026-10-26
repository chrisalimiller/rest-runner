import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab or Shift+Tab goes next in a list of `count` focusable things, wrapping at the ends. -1 means leave it to the browser. */
export function nextFocusIndex(count: number, current: number, shift: boolean): number {
  if (count === 0) return -1;
  if (current === -1) return shift ? count - 1 : 0;
  const next = current + (shift ? -1 : 1);
  return next < 0 ? count - 1 : next >= count ? 0 : next;
}

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Keeps Tab and Shift+Tab inside a modal while it is open. Focus moves in when the modal opens
 * (to something with `autoFocus` or the first focusable thing) unless it is already inside.
 * Pair it with `useEscape`, which puts focus back where it was when the modal closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    if (!root.contains(document.activeElement)) (visibleFocusables(root)[0] ?? root).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented || !ref.current) return;
      const items = visibleFocusables(ref.current);
      const next = nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      const atEdge = e.shiftKey ? items.indexOf(document.activeElement as HTMLElement) <= 0 : items.indexOf(document.activeElement as HTMLElement) === items.length - 1;
      if (next === -1) {
        e.preventDefault();
        return;
      }
      if (atEdge || !ref.current.contains(document.activeElement)) {
        e.preventDefault();
        items[next].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, active]);
}
