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
