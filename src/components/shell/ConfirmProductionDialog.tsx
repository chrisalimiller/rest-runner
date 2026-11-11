import { Modal } from "./Modal";
import "./confirmProduction.css";

/** Asks before something is sent to an environment flagged as production. `what` is e.g. "Send" or "Run 12 requests". */
export function ConfirmProductionDialog({ envName, what, onConfirm, onCancel }: { envName: string; what: string; onConfirm: () => void; onCancel: () => void }) {
  const single = what === "Send";
  return (
    <Modal label="Confirm production send" onClose={onCancel} className="production-confirm">
      <div className="production-confirm-content">
        <p className="production-confirm-label"><span aria-hidden="true" />Production environment</p>
        <h3>{single ? `Send to ${envName}?` : `${what} on ${envName}?`}</h3>
        <p className="production-confirm-description">{single ? "This sends a real request to your production environment." : "This sends real requests to your production environment."}</p>
        <p className="muted small">You can turn this prompt off in Settings, under General.</p>
        <div className="production-confirm-actions">
          <button className="secondary" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="production-confirm-send" onClick={onConfirm}>
            {what} {single ? "to" : "on"} {envName}
          </button>
        </div>
      </div>
    </Modal>
  );
}
