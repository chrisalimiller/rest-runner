import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { shouldAnimateToggle } from "../lib/treeMotion";

type Mode = "idle" | "opening" | "closing";

function cssMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : n * 1000;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Child list of a tree node. Children are mounted only while open (or while animating closed), so
 * long trees stay cheap. Height animates with WAAPI; a subtree over the row cap, reduced motion, or a
 * rapid repeat toggle switches instantly. A closing list is inert so it cannot take focus.
 */
export function TreeChildren({ open, rows, dragging, children }: { open: boolean; rows: number; dragging?: boolean; children: ReactNode }) {
  const [prevOpen, setPrevOpen] = useState(open);
  const [mode, setMode] = useState<Mode>("idle");
  const lastToggle = useRef(0);
  const ref = useRef<HTMLUListElement>(null);
  const fromHeight = useRef<number | null>(null);

  if (prevOpen !== open) {
    setPrevOpen(open);
    const now = Date.now();
    const animate = shouldAnimateToggle({
      rows,
      reducedMotion: prefersReducedMotion(),
      sinceLastToggleMs: now - lastToggle.current,
      dragging,
    });
    lastToggle.current = now;
    setMode(animate ? (open ? "opening" : "closing") : "idle");
  }

  useLayoutEffect(() => {
    if (mode === "idle") return;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") {
      setMode("idle");
      return;
    }
    const target = mode === "opening" ? el.scrollHeight : 0;
    const start = fromHeight.current ?? (mode === "opening" ? 0 : el.scrollHeight);
    fromHeight.current = null;
    const anim = el.animate(
      [
        { height: `${start}px`, overflow: "hidden" },
        { height: `${target}px`, overflow: "hidden" },
      ],
      { duration: cssMs("--dur-base", 160), easing: getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim() || "ease-out" },
    );
    anim.onfinish = () => setMode("idle");
    return () => {
      // Re-toggled mid-flight: remember the current height so the next animation continues from it.
      if (anim.playState === "running") fromHeight.current = el.getBoundingClientRect().height;
      anim.onfinish = null;
      anim.cancel();
    };
  }, [mode]);

  if (!open && mode !== "closing") return null;
  return (
    <ul className="tree" ref={ref} inert={!open}>
      {children}
    </ul>
  );
}
