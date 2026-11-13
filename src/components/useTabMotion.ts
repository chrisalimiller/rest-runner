import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * One underline that slides between the tabs of a strip instead of each tab drawing its own. It measures the active
 * tab (`.active`) and publishes its position as --ul-x / --ul-w on the strip; motion.css draws and animates it.
 * The first measurement is not animated, so a strip that has just mounted does not sweep in from the left.
 */
export function useSlidingUnderline(strip: RefObject<HTMLElement | null>, activeKey: string) {
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => {
      const tab = el.querySelector<HTMLElement>(".active");
      if (!tab) {
        el.style.setProperty("--ul-w", "0px");
        return;
      }
      el.style.setProperty("--ul-x", `${tab.offsetLeft}px`);
      el.style.setProperty("--ul-w", `${tab.offsetWidth}px`);
    };
    measure();
    if (!el.classList.contains("ul-ready")) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("ul-ready")));
    // Counts and labels change a tab's width without changing which tab is active.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll("button").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [strip, activeKey]);
}

/** Fades a panel's content when its tab changes (not on first render), without remounting what is inside it. */
export function usePanelFade(panel: RefObject<HTMLElement | null>, activeKey: string) {
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = panel.current;
    if (!el) return;
    el.classList.remove("tab-swap");
    void el.offsetWidth;
    el.classList.add("tab-swap");
  }, [panel, activeKey]);
}
