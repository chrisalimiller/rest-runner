import type { CSSProperties } from "react";
import { Modal } from "../shell/Modal";

interface Props {
  /** The button's text. */
  action: string;
  /** The write request, "POST /subscribers/42/suspend". */
  request: string;
  /** The coloured environment this goes to, or null when the block asked on an ordinary one. */
  guard: { name: string; cssColor: string } | null;
  /** The block's own confirm text, if it has one. */
  text?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asked before an Action button sends to a production-marked environment (or when the block has confirm text). Cancel is the focused button. */
export function ConfirmActionDialog({ action, request, guard, text, onConfirm, onCancel }: Props) {
  return (
    <Modal label="Confirm action" onClose={onCancel} className="small-modal">
      <div className="modal-head">
        <h3>{guard ? `${action} on ${guard.name}?` : `${action}?`}</h3>
      </div>
      <div className="dialog-body">
        {text && <p>{text}</p>}
        {guard && (
          <p>
            This sends to <strong>{guard.name}</strong>, which is marked as production.
          </p>
        )}
        <p className="muted small mono">{request}</p>
      </div>
      <div className="modal-foot">
        <button className="secondary" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <span className="flex-gap" />
        <button className={`send ${guard ? "guarded" : ""}`} style={guard ? ({ "--guard": guard.cssColor } as CSSProperties) : undefined} onClick={onConfirm}>
          {guard ? `${action} on ${guard.name}` : action}
        </button>
      </div>
    </Modal>
  );
}
