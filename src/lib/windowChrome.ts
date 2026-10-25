import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Window title bar handling.
 *
 * On macOS the window uses an overlay title bar (see tauri.conf.json): the page runs to the top
 * edge and the native traffic lights sit inside the top bar. The top bar then needs room on the
 * left for the buttons and has to act as the drag area. Windows keeps its native title bar,
 * recolored from Rust (src-tauri/src/lib.rs), so nothing changes in the page there.
 */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** True when the native title bar is hidden and the top bar stands in for it. */
export const overlayTitleBar = isTauri && isMac;

/** Adds the classes the top bar styles key off, and tracks full screen (no traffic lights there). */
export function setupWindowChrome() {
  if (!overlayTitleBar) return;
  const root = document.documentElement;
  root.classList.add("overlay-titlebar");
  const win = getCurrentWindow();
  const sync = () =>
    win
      .isFullscreen()
      .then((full) => root.classList.toggle("is-fullscreen", full))
      .catch(() => {});
  void sync();
  void win.onResized(sync);
}
