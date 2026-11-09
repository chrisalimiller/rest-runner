import { formatKeys, isMacPlatform, SHORTCUT_GROUPS, SHORTCUTS } from "../../lib/shortcuts";
import { Modal } from "./Modal";
import "./shell.css";

/** The keyboard shortcut list, from the same map the command palette reads its keys from. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const mac = isMacPlatform();
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose} className="shortcuts-modal">
      <div className="modal-head">
        <h3>Keyboard shortcuts</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="shortcuts-body">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} aria-label={group}>
            <h4 className="shortcuts-group">{group}</h4>
            <dl className="shortcuts-list">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="shortcuts-row">
                  <dt>{s.label}</dt>
                  <dd>
                    <kbd>{formatKeys(s.keys, mac)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
