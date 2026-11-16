import { load, save } from "./storage";

/**
 * Display density: Compact, Default or Comfortable. The page gets it as `<html data-density="compact|comfortable">`
 * (Default sets no attribute), and styles.css turns that into --ui-scale / --type-scale, which every font size and
 * row or control height is built from.
 */
export type DensityPref = "compact" | "default" | "comfortable";

/**
 * Stored through storage.ts, so the value is JSON (`"compact"` with quotes). The inline script in index.html reads
 * this same key and format to set data-density before React mounts; a test (density.test.ts) checks the two stay in step.
 */
export const DENSITY_KEY = "rest-runner.density";
export const DENSITY_PREFS: DensityPref[] = ["compact", "default", "comfortable"];

export const isDensityPref = (x: unknown): x is DensityPref => x === "compact" || x === "default" || x === "comfortable";

export function getDensityPref(): DensityPref {
  return load<DensityPref>(DENSITY_KEY, "default", isDensityPref);
}

/** Sets (or clears, for Default) data-density on <html>. */
export function applyDensity(pref: DensityPref = getDensityPref()): void {
  if (typeof document === "undefined") return;
  if (pref === "default") delete document.documentElement.dataset.density;
  else document.documentElement.dataset.density = pref;
}

/** Saves the choice and applies it right away. */
export function setDensityPref(pref: DensityPref): void {
  save(DENSITY_KEY, pref);
  applyDensity(pref);
}

/** Call once at startup. */
export function initDensity(): void {
  applyDensity();
}
