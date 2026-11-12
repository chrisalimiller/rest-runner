import type { Mode } from "../components/shell/TopBar";

/** Below this window width the search field shrinks to a magnifier with its shortcut hint. */
export const COMPACT_SEARCH_BELOW = 1366;
/** Below this window width the environment switch is a dropdown. */
export const ENV_DROPDOWN_BELOW = 1200;
/** With more environments than this, the switch is a dropdown at any width. */
export const MAX_ENV_BUTTONS = 3;

export interface TopBarLayout {
  compactSearch: boolean;
  envDropdown: boolean;
}

/** How the top bar lays out for a window width and a number of environments (not counting None). */
export function topBarLayout(width: number, environmentCount: number): TopBarLayout {
  return {
    compactSearch: width < COMPACT_SEARCH_BELOW,
    envDropdown: environmentCount > MAX_ENV_BUTTONS || width < ENV_DROPDOWN_BELOW,
  };
}

/** Collapse levels the top bar steps through as space runs out: 1 request path, 2 search, 3 environment switch. */
export const MAX_FIT_LEVEL = 3;
/** Spare width needed beyond what the next level down takes back, so the bar does not flicker between two levels. */
export const FIT_SLACK_PX = 24;

/**
 * The next collapse level for the top bar. `overflowPx` is how far the bar's content spills past its edge,
 * `spareWidthPx` the free room it has, and `nextLevelNeedsPx` the width the next level down (one less collapsed) takes back.
 */
export function nextFitLevel(level: number, overflowPx: number, spareWidthPx: number, nextLevelNeedsPx: number): number {
  if (overflowPx > 1) return Math.min(MAX_FIT_LEVEL, level + 1);
  if (level > 0 && spareWidthPx >= nextLevelNeedsPx + FIT_SLACK_PX) return level - 1;
  return level;
}

/** The sections in switcher order; Ctrl/Cmd + 1, 2, 3, 4 pick them. */
export const MODES: readonly Mode[] = ["requests", "testing", "flows", "tools"];

/** Which button gets focus after a key press in the status bar's section group (wrapping), or null when the key does nothing there. */
export function nextModeIndex(current: number, key: string, count = MODES.length): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The section a Ctrl/Cmd + 1-4 key press switches to. Uses the physical key so it works on any layout. */
export function modeForShortcut(e: { code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Mode | null {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return null;
  const m = /^Digit([1-4])$/.exec(e.code);
  return m ? MODES[Number(m[1]) - 1] : null;
}
