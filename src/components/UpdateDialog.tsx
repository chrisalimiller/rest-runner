import { useEffect, useRef, useState } from "react";
import { Modal } from "./shell/Modal";
import { AppearanceControl } from "./shell/AppearanceControl";
import { isBusy } from "../lib/busyWork";
import { canUpdate, checkForUpdate, installedVersion, type FoundUpdate } from "../lib/updater";
import { downloadPercent, plainNotes, releaseDate, versionLabel, type UpdateInfo, type UpdateState } from "../lib/updates";
import "./updateDialog.css";

/** About REST Runner: the installed version and a Check for updates button. Nothing is checked until it is clicked. */
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
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

  const onInstallClick = (info: UpdateInfo) => {
    if (isBusy()) setState({ kind: "confirm-stop", info });
    else void install(info);
  };

  return (
    <Modal label="About REST Runner" onClose={() => !working && onClose()} className="update-modal">
      <div className="modal-head">
        <h3>About REST Runner</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={working}>
          ×
        </button>
      </div>
      <div className="update-body">
        <p className="update-version">
          Installed version <strong>{versionLabel(version) || "unknown"}</strong>
        </p>
        <AppearanceControl />
        <UpdateStatus state={state} supported={supported} />
      </div>
      <div className="update-foot">
        <Actions state={state} supported={supported} onClose={onClose} onCheck={() => void check()} onInstall={onInstallClick} onConfirm={(info) => void install(info)} onBack={(info) => setState({ kind: "available", info })} />
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
                <div className="progress-fill" style={{ width: `${percent ?? 100}%`, opacity: percent === null ? 0.4 : 1 }} />
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
      <button className="primary" onClick={onCheck} disabled={!supported || state.kind === "checking"} autoFocus={supported}>
        {state.kind === "error" ? "Try again" : "Check for updates"}
      </button>
    </>
  );
}
