import { Modal } from "./Modal";

/** Asks before something is sent to an environment flagged as production. `what` is e.g. "Send" or "Run 12 requests". */
export function ConfirmProductionDialog({ envName, what, onConfirm, onCancel }: { envName: string; what: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal label="Confirm production send" onClose={onCancel}>
      <div className="modal-head">
        <h3>Send to production?</h3>
        <button className="icon-btn" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>
      <div className="update-body">
        <p>
          The active environment, <strong>{envName}</strong>, is marked as production. {what} will go to it for real.
        </p>
        <p className="muted small">You can turn this prompt off in About, under Settings.</p>
      </div>
      <div className="update-foot">
        <button className="secondary" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button className="primary" onClick={onConfirm}>
          {what} on {envName}
        </button>
      </div>
    </Modal>
  );
}
