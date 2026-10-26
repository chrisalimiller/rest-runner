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

/** The sections in switcher order; Ctrl/Cmd + 1, 2, 3 pick them. */
export const MODES: readonly Mode[] = ["requests", "testing", "flows"];

/** Which segment gets focus after a key press in the section switcher (wrapping), or null when the key does nothing there. */
export function nextModeIndex(current: number, key: string, count = 3): number | null {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The section a Ctrl/Cmd + 1-3 key press switches to. Uses the physical key so it works on any layout. */
export function modeForShortcut(e: { code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Mode | null {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return null;
  const m = /^Digit([1-3])$/.exec(e.code);
  return m ? MODES[Number(m[1]) - 1] : null;
}
