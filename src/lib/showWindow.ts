import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The main window starts hidden (`visible: false` in tauri.conf.json) so a user whose theme differs from the
 * dark native background never sees a dark flash. Once the theme is applied and the page has painted, show it.
 * Tradeoff: launch feels a few frames later. If this fails, a timer in src-tauri/src/lib.rs shows the window
 * after ~1.5s, so it can never stay hidden. No-op in a plain browser.
 */
export function showWindowWhenReady(): void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  // Two frames: the first runs before paint, the second after the first paint has happened.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      try {
        void getCurrentWindow().show().catch(() => {});
      } catch {
        /* the Rust safety net shows the window */
      }
    }),
  );
}
