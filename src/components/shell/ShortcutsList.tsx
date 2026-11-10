import { formatKeys, isMacPlatform, SHORTCUT_GROUPS, SHORTCUTS } from "../../lib/shortcuts";
import "./shell.css";

/** The hotkey cheat sheet, straight from the shortcut registry. Used by the shortcuts dialog and About. */
export function ShortcutsList() {
  const mac = isMacPlatform();
  return (
    <>
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
    </>
  );
}
