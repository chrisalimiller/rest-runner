import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { MAX_FIT_LEVEL, nextFitLevel } from "../../lib/topBar";

/** Width the header's content needs, ignoring the stretchy spacer: children, the gaps between them, and padding. */
function neededWidth(header: HTMLElement): number {
  const style = getComputedStyle(header);
  const gap = parseFloat(style.columnGap) || 0;
  const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const kids = Array.from(header.children).filter((c) => !c.classList.contains("topbar-gap")) as HTMLElement[];
  // The request switcher keeps its folder path and method at full size and clips them when it shrinks, so ask its box what it holds.
  const width = (k: HTMLElement) => {
    const btn = k.querySelector<HTMLElement>(".switcher-btn");
    return btn ? Math.max(k.offsetWidth, btn.scrollWidth + 2) : k.offsetWidth;
  };
  return kids.reduce((sum, k) => sum + width(k), 0) + gap * Math.max(0, kids.length) + pad;
}

/** What the bar's changing parts say, so a new name or section starts the measuring over. */
function contentKey(header: HTMLElement): string {
  return header.querySelector(".switcher")?.textContent ?? "";
}

/**
 * How far the top bar has had to collapse (0 to 4) to stay on one row. It measures the real header, so it
 * accounts for long names and folder paths that a window width alone cannot. `resetKey` covers things the
 * header's text does not show, like the number of environments.
 */
export function useTopBarFit(ref: RefObject<HTMLElement | null>, resetKey: string | number = ""): number {
  const [level, setLevel] = useState(0);
  // Content needed at each level the last time it was on screen; the difference is what a level gives back.
  const needs = useRef<number[]>([]);
  const lastKey = useRef("");
  const levelRef = useRef(0);
  levelRef.current = level;

  const measure = () => {
    const header = ref.current;
    // A section that is not showing has no width to measure.
    if (!header || header.clientWidth === 0) return;
    const key = `${resetKey}|${contentKey(header)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      needs.current = [];
      if (levelRef.current !== 0) {
        setLevel(0);
        return;
      }
    }
    const cur = levelRef.current;
    const need = neededWidth(header);
    needs.current[cur] = need;
    const btn = header.querySelector<HTMLElement>(".switcher-btn");
    const overflow = Math.max(header.scrollWidth - header.clientWidth, btn ? btn.scrollWidth - btn.clientWidth : 0);
    const spare = header.clientWidth - need;
    const below = needs.current[cur - 1];
    // Unknown until measured; a level never visited cannot be known to fit, so it is not tried.
    const nextNeeds = cur > 0 && below !== undefined ? Math.max(0, below - need) : Number.POSITIVE_INFINITY;
    const next = nextFitLevel(cur, overflow, spare, nextNeeds);
    if (next !== cur) setLevel(Math.min(MAX_FIT_LEVEL, next));
  };

  // After every render, so each new level is measured as soon as it lays out and before it paints.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return level;
}
