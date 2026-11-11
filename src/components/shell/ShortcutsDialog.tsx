import { Modal } from "./Modal";
import { ShortcutsList } from "./ShortcutsList";
import "./shell.css";

/** The keyboard shortcut list, from the same map the command palette reads its keys from. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose} className="shortcuts-modal">
      <div className="modal-head">
        <h3>Keyboard shortcuts</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="shortcuts-body">
        <ShortcutsList />
      </div>
    </Modal>
  );
}
