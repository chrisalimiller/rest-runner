import { useLayoutEffect, type RefObject } from "react";

const GHOST_MAX_MS = 600;

function longestMs(value: string): number {
  return Math.max(
    0,
    ...value.split(",").map((part) => {
      const n = parseFloat(part);
      if (!Number.isFinite(n)) return 0;
      return part.trim().endsWith("ms") ? n : n * 1000;
    }),
  );
}

/**
 * Plays an exit animation for an element that React is about to remove. Parents unmount overlays
 * immediately (`{open && <Modal />}`), so instead of delaying that, a dead copy of the element is
 * left in its place with `data-state="closing"`; CSS animates it out and it removes itself.
 * The copy is inert, hidden from assistive tech and ignores the pointer. Where CSS defines no
 * exit animation (jsdom, tests) nothing is left behind. Returns the copy, or null.
 */
export function playExit(node: HTMLElement): HTMLElement | null {
  const parent = node.parentNode;
  if (!parent || !node.isConnected) return null;
  const ghost = node.cloneNode(true) as HTMLElement;
  ghost.setAttribute("data-state", "closing");
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.style.pointerEvents = "none";
  ghost.removeAttribute("id");
  for (const el of ghost.querySelectorAll<HTMLElement>("[id]")) el.removeAttribute("id");
  for (const el of ghost.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [tabindex]")) el.tabIndex = -1;
  parent.insertBefore(ghost, node);
  const style = getComputedStyle(ghost);
  const ms = Math.min(GHOST_MAX_MS, longestMs(style.animationDuration) + longestMs(style.animationDelay));
  if (ms <= 0) {
    ghost.remove();
    return null;
  }
  setTimeout(() => ghost.remove(), ms + 50);
  return ghost;
}

/** Call in an overlay component with a ref to its outermost element: it fades out when the component unmounts. */
export function useExitTransition(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node) playExit(node);
    };
  }, [ref]);
}
