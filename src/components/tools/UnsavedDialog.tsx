import { Modal } from "../shell/Modal";

interface Props {
  toolName: string;
  /** Why Save is not possible, when it is not (for example a loop of calls). */
  blocked?: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/** Asked before leaving Build mode, switching tools or leaving the section with edits that are not saved. */
export function UnsavedDialog({ toolName, blocked, onSave, onDiscard, onCancel }: Props) {
  return (
    <Modal label="Unsaved changes" onClose={onCancel} className="small-modal">
      <div className="modal-head">
        <h3>Save changes to “{toolName || "(unnamed)"}”?</h3>
      </div>
      <div className="dialog-body">
        <p>You changed this tool and have not saved it.</p>
        {blocked && (
          <p className="tone-bad" role="alert">
            It cannot be saved yet: {blocked}
          </p>
        )}
      </div>
      <div className="modal-foot">
        <button className="secondary" onClick={onCancel} autoFocus>
          Keep editing
        </button>
        <span className="flex-gap" />
        <button className="secondary" onClick={onDiscard}>
          Discard
        </button>
        <button className="send" onClick={onSave} disabled={!!blocked}>
          Save
        </button>
      </div>
    </Modal>
  );
}
