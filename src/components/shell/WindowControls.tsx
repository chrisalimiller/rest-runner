import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const win = () => getCurrentWindow();

/**
 * Minimize, maximize/restore and close for the Windows build, where the native title bar is turned off and the top
 * bar stands in for it (see windowChrome.ts). The buttons are the app's own; Windows 11's snap-layout flyout on the
 * maximize button is not available, but dragging to an edge and Win + arrow keys still snap.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    const sync = () =>
      win()
        .isMaximized()
        .then((m) => alive && setMaximized(m))
        .catch(() => {});
    void sync();
    const un = win().onResized(sync);
    return () => {
      alive = false;
      void un.then((f) => f()).catch(() => {});
    };
  }, []);

  return (
    <div className="win-controls" role="group" aria-label="Window controls">
      <button type="button" onClick={() => void win().minimize()} aria-label="Minimize" title="Minimize">
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" />
        </svg>
      </button>
      <button type="button" onClick={() => void win().toggleMaximize()} aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"}>
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden>
            <rect x="2.5" y="0.5" width="7" height="7" rx="1.5" />
            <path d="M0.5 2.5v6a1 1 0 001 1h6" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden>
            <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
          </svg>
        )}
      </button>
      <button type="button" className="close" onClick={() => void win().close()} aria-label="Close" title="Close">
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
