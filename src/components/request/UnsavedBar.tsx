import { useEffect, useState } from "react";

interface Props {
  /** "changed": a saved request that has been edited (can be discarded). "new": never saved, so only Save. */
  kind: "changed" | "new";
  onSave: () => void;
  onDiscard: () => void;
  /** Shortcut shown on the Save button, e.g. "Ctrl S". */
  shortcut: string;
}

/**
 * A small bar over the bottom of the request column while the request has unsaved changes.
 * Discard asks once more on the same button, since it throws the edits away.
 */
export function UnsavedBar({ kind, onSave, onDiscard, shortcut }: Props) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <div className="unsaved-bar" role="status">
      <span className="unsaved-bar-label">
        <span className="unsaved-bar-dot" aria-hidden />
        {kind === "new" ? "Not saved" : "Unsaved changes"}
      </span>
      {kind === "changed" && (
        <button
          className={`secondary ${confirming ? "danger" : ""}`}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            onDiscard();
          }}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? "Discard changes?" : "Discard"}
        </button>
      )}
      <button className="send" onClick={onSave} title={`Save (${shortcut})`}>
        Save
        <span className="kbd-hint">{shortcut}</span>
      </button>
    </div>
  );
}
