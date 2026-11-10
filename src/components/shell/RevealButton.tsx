import { EyeIcon, EyeOffIcon } from "./Icons";
import "../dlg.css";

interface Props {
  /** True while the value is showing. */
  shown: boolean;
  onToggle: () => void;
  /** What is being revealed, e.g. "token". Used in the accessible name. */
  subject?: string;
}

/**
 * A bordered 26x24 button with a 16px eye: open eye while the value is hidden, struck-through eye while it shows.
 * The caller keeps the state (and should not save it).
 */
export function RevealButton({ shown, onToggle, subject }: Props) {
  const action = shown ? "Hide value" : "Show value";
  const label = subject ? `${action} of ${subject}` : action;
  return (
    <button type="button" className={`reveal-btn${shown ? " on" : ""}`} onClick={onToggle} aria-pressed={shown} aria-label={label} title={action}>
      {shown ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
    </button>
  );
}
