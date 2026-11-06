import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalSize } from "@tauri-apps/api/dpi";

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

/** How far (CSS px) the page may differ from the window before the webview counts as out of step. */
const SIZE_TOLERANCE_PX = 8;

/** True when the page's viewport is clearly smaller than the window it sits in (or has collapsed to nothing). */
export function viewportOutOfStep(viewW: number, viewH: number, winW: number, winH: number): boolean {
  if (winW <= 0 || winH <= 0) return false;
  return viewW < winW - SIZE_TOLERANCE_PX || viewH < winH - SIZE_TOLERANCE_PX;
}

/**
 * After a window is restored from the Dock, macOS can leave the webview at a stale, tiny size, so the whole
 * page is squeezed into the title bar until the app is restarted. When the page's viewport no longer matches
 * the window, nudge the window by one pixel and back, which makes the webview lay out again.
 */
function healWebviewSize(win: ReturnType<typeof getCurrentWindow>) {
  let busy = false;
  const check = async () => {
    if (busy) return;
    try {
      const [size, scale, minimized] = await Promise.all([win.innerSize(), win.scaleFactor(), win.isMinimized()]);
      if (minimized) return;
      const winW = size.width / scale;
      const winH = size.height / scale;
      if (!viewportOutOfStep(window.innerWidth, window.innerHeight, winW, winH)) return;
      busy = true;
      await win.setSize(new PhysicalSize(size.width + 1, size.height + 1));
      await win.setSize(new PhysicalSize(size.width, size.height));
    } catch {
      // Best effort only.
    } finally {
      busy = false;
    }
  };
  // Restoring fires focus and visibility changes; give the system a moment to finish animating first.
  const later = () => {
    for (const ms of [50, 400]) window.setTimeout(() => void check(), ms);
  };
  window.addEventListener("focus", later);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) later();
  });
  void win.onResized(later);
}

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
  healWebviewSize(win);
}
