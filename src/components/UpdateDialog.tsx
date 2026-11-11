import { useEffect, useRef, useState } from "react";
import { Modal } from "./shell/Modal";
import { keychainNote } from "../lib/secretsUi";
import { AppearanceControl } from "./shell/AppearanceControl";
import { isBusy } from "../lib/busyWork";
import { canUpdate, checkForUpdate, installedVersion, type FoundUpdate } from "../lib/updater";
import { downloadPercent, plainNotes, releaseDate, versionLabel, type UpdateInfo, type UpdateState } from "../lib/updates";
import { ShortcutsList } from "./shell/ShortcutsList";
import { loadConfirmProduction, saveConfirmProduction } from "../lib/productionGuard";
import { DEFAULT_RESPONSE_LIMIT, MAX_RESPONSE_LIMIT, getResponseLimit, setResponseLimit } from "../lib/http";
import "./updateDialog.css";

type SettingsPage = "general" | "shortcuts" | "about";

/** Settings and About: updates are checked only when requested. */
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<SettingsPage>("general");
  const [version, setVersion] = useState("");
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const [confirmProd, setConfirmProd] = useState(loadConfirmProduction);
  const [limit, setLimit] = useState(() => String(getResponseLimit()));
  const [limitError, setLimitError] = useState("");
  const found = useRef<FoundUpdate | null>(null);
  const supported = canUpdate();
  const working = state.kind === "checking" || state.kind === "downloading" || state.kind === "installing";

  useEffect(() => {
    let live = true;
    void installedVersion().then((v) => live && setVersion(v));
    return () => {
      live = false;
      void found.current?.close();
    };
  }, []);

  const check = async () => {
    setState({ kind: "checking" });
    try {
      await found.current?.close();
      found.current = null;
      const update = await checkForUpdate();
      if (!update) return setState({ kind: "current" });
      found.current = update;
      setState({ kind: "available", info: update.info });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const install = async (info: UpdateInfo) => {
    const update = found.current;
    if (!update) return;
    setState({ kind: "downloading", info, received: 0 });
    try {
      await update.install(
        (received, total) => setState({ kind: "downloading", info, received, total }),
        () => setState({ kind: "installing", info }),
      );
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveLimit = () => {
    const value = Number(limit);
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESPONSE_LIMIT) {
      return setLimitError(`Enter a whole number from 1 to ${MAX_RESPONSE_LIMIT.toLocaleString("en-US")}.`);
    }
    setLimitError(setResponseLimit(value) ? "" : "Could not save the limit.");
  };

  const onInstallClick = (info: UpdateInfo) => {
    if (isBusy()) setState({ kind: "confirm-stop", info });
    else void install(info);
  };

  return (
    <Modal label="Settings" onClose={() => !working && onClose()} className="update-modal">
      <div className="modal-head">
        <div><h3>Settings</h3><p className="settings-subtitle">Manage your REST Runner preferences</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={working}>
          ×
        </button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {([ ["general", "General"], ["shortcuts", "Keyboard shortcuts"], ["about", "About & updates"] ] as const).map(([id, label]) => (
            <button key={id} type="button" className={page === id ? "selected" : ""} aria-current={page === id ? "page" : undefined} disabled={working} onClick={() => setPage(id)}>{label}</button>
          ))}
        </nav>
        <div className="update-body">
          {page === "general" && <>
            <h4>General</h4><p className="settings-intro">Choose how the app looks and behaves.</p>
            <section className="settings-block"><AppearanceControl /></section>
            <section className="settings-block">
              <label className="update-setting">
                <span>Confirm production requests</span>
                <input type="checkbox" checked={confirmProd} onChange={(e) => { setConfirmProd(e.target.checked); saveConfirmProduction(e.target.checked); }} />
              </label>
              <p className="muted small">Ask before single sends and batch runs to environments marked Production.</p>
            </section>
            <section className="settings-block">
              <label className="update-setting">
                <span>Response size limit (bytes)</span>
                <input type="number" min={1} max={MAX_RESPONSE_LIMIT} step={1} value={limit} aria-invalid={limitError ? true : undefined} aria-describedby="response-limit-help"
                  onChange={(e) => { setLimit(e.target.value); setLimitError(""); }} onBlur={saveLimit} />
              </label>
              <p id="response-limit-help" className="muted small">Largest decoded response body a request may return, up to {MAX_RESPONSE_LIMIT.toLocaleString("en-US")}. Larger responses fail instead of being shown. Default: {DEFAULT_RESPONSE_LIMIT.toLocaleString("en-US")}.</p>
              {limitError && <p role="alert" className="update-error">{limitError}</p>}
            </section>
            <section className="settings-block"><strong>Secret storage</strong><p className="muted small">{keychainNote(typeof navigator === "undefined" ? "" : navigator.platform)}</p></section>
          </>}
          {page === "shortcuts" && <><h4>Keyboard shortcuts</h4><p className="settings-intro">Quick access to common actions.</p><ShortcutsList /></>}
          {page === "about" && <>
            <h4>About REST Runner</h4><p className="settings-intro">Version and update information.</p>
            <div className="settings-version"><p>Installed version <strong>{versionLabel(version) || "unknown"}</strong></p><UpdateStatus state={state} supported={supported} /></div>
          </>}
        </div>
      </div>
      <div className="update-foot">
        {page === "about" ? <Actions state={state} supported={supported} onClose={onClose} onCheck={() => void check()} onInstall={onInstallClick} onConfirm={(info) => void install(info)} onBack={(info) => setState({ kind: "available", info })} /> : <button className="secondary" onClick={onClose}>Close</button>}
      </div>
    </Modal>
  );
}

function UpdateStatus({ state, supported }: { state: UpdateState; supported: boolean }) {
  if (!supported) return <p className="muted">Updates work in installed builds only.</p>;
  switch (state.kind) {
    case "idle":
      return <p className="muted">REST Runner only looks for a new version when you click Check for updates.</p>;
    case "checking":
      return <p role="status">Checking for updates…</p>;
    case "current":
      return <p role="status">You have the latest version.</p>;
    case "error":
      return (
        <p role="alert" className="update-error">
          {state.message}
        </p>
      );
    case "available":
    case "confirm-stop":
    case "downloading":
    case "installing": {
      const { info } = state;
      const date = releaseDate(info.date);
      const notes = plainNotes(info.notes);
      const percent = state.kind === "downloading" ? downloadPercent(state.received, state.total) : null;
      return (
        <div role="status">
          <p>
            <strong>{versionLabel(info.version)}</strong> is available{date ? `, released ${date}` : ""}.
          </p>
          {notes && <pre className="update-notes">{notes}</pre>}
          {state.kind === "confirm-stop" && <p className="update-warn">A batch, test run or flow is running. Updating restarts the app and stops it.</p>}
          {state.kind === "downloading" && (
            <>
              <p>Downloading…{percent !== null ? ` ${percent}%` : ""}</p>
              <div className="progress-bar" aria-hidden>
                <div className="progress-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, (percent ?? 100) / 100))})`, opacity: percent === null ? 0.4 : 1 }} />
              </div>
            </>
          )}
          {state.kind === "installing" && <p>Installing. REST Runner will restart in a moment.</p>}
        </div>
      );
    }
  }
}

interface ActionProps {
  state: UpdateState;
  supported: boolean;
  onClose: () => void;
  onCheck: () => void;
  onInstall: (info: UpdateInfo) => void;
  onConfirm: (info: UpdateInfo) => void;
  onBack: (info: UpdateInfo) => void;
}

function Actions({ state, supported, onClose, onCheck, onInstall, onConfirm, onBack }: ActionProps) {
  if (state.kind === "downloading" || state.kind === "installing") return null;
  if (state.kind === "confirm-stop") {
    return (
      <>
        <button className="secondary" onClick={() => onBack(state.info)}>
          Cancel
        </button>
        <button className="primary" onClick={() => onConfirm(state.info)} autoFocus>
          Stop the run and update
        </button>
      </>
    );
  }
  if (state.kind === "available") {
    return (
      <>
        <button className="secondary" onClick={onClose}>
          Not now
        </button>
        <button className="primary" onClick={() => onInstall(state.info)} autoFocus>
          Download and install
        </button>
      </>
    );
  }
  return (
    <>
      <button className="secondary" onClick={onClose}>
        Close
      </button>
      <button className="primary" onClick={onCheck} disabled={!supported || state.kind === "checking"}>
        {state.kind === "error" ? "Try again" : "Check for updates"}
      </button>
    </>
  );
}
