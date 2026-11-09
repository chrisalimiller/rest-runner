import { getCurrentWindow } from "@tauri-apps/api/window";
import { load, save } from "./storage";

/**
 * Appearance: Dark, Light, or follow the system. The saved choice is "system" by default; the page
 * always gets the RESOLVED value as `<html data-theme="dark|light">` (never "system"), and the CSS
 * (`color-scheme` included) keys off that attribute.
 */
export type ThemePref = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

/**
 * Stored through storage.ts, so the value is JSON (`"dark"` with quotes). The inline script in
 * index.html reads this same key and format to set data-theme before React mounts; a test
 * (theme.test.ts) checks the two stay in step.
 */
export const THEME_KEY = "rest-runner.theme";
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark"];

export const isThemePref = (x: unknown): x is ThemePref => x === "system" || x === "dark" || x === "light";

export function getThemePref(): ThemePref {
  return load<ThemePref>(THEME_KEY, "system", isThemePref);
}

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

const query = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null);
/** With no way to ask, assume dark (the app's original look). */
const systemPrefersDark = () => query()?.matches ?? true;

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Asks the native window (title bar, menus) to follow the choice; null means follow the system. No-op outside Tauri. */
function syncNativeTheme(pref: ThemePref, resolved: ResolvedTheme) {
  if (!isTauri) return;
  try {
    const win = getCurrentWindow();
    void win.setTheme(pref === "system" ? null : pref).catch(() => {});
    // The window behind the page (seen while resizing); keep it the same as --bg.
    void win.setBackgroundColor(resolved === "light" ? "#e9edf2" : "#0d1117").catch(() => {});
  } catch {
    // Best effort only.
  }
}

/** Sets data-theme on <html> for the saved or given choice, and returns what it resolved to. */
export function applyTheme(pref: ThemePref = getThemePref()): ResolvedTheme {
  const resolved = resolveTheme(pref, systemPrefersDark());
  if (typeof document !== "undefined") document.documentElement.dataset.theme = resolved;
  syncNativeTheme(pref, resolved);
  return resolved;
}

let stopWatching: (() => void) | null = null;

/** While the choice is "system", re-applies when the operating system switches between dark and light. */
function watchSystem(pref: ThemePref) {
  stopWatching?.();
  stopWatching = null;
  const mq = pref === "system" ? query() : null;
  if (!mq) return;
  const onChange = () => applyTheme("system");
  mq.addEventListener("change", onChange);
  stopWatching = () => mq.removeEventListener("change", onChange);
}

/** Saves the choice and applies it right away. */
export function setThemePref(pref: ThemePref): void {
  save(THEME_KEY, pref);
  applyTheme(pref);
  watchSystem(pref);
}

/** Call once at startup. */
export function initTheme(): void {
  const pref = getThemePref();
  applyTheme(pref);
  watchSystem(pref);
}
