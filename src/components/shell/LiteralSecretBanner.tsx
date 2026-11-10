import "./shell.css";
import { AlertIcon } from "./Icons";

interface Props {
  /** Point the credential field's aria-describedby at this id. */
  id: string;
  /** What is stored, as the headline names it: Password, Token, API key value. */
  label?: string;
  /** Moves the credential into a secret variable. Leave out where there is nothing to convert into (no button is shown). */
  onConvert?: () => void;
  /** Name of the active environment. Without one the button is disabled and the banner says why. */
  envName?: string;
}

/** Warn-only callout under a field that holds a credential typed in plain text. It wraps, so it never clips. */
export function LiteralSecretBanner({ id, label = "Password", onConvert, envName }: Props) {
  const noEnv = !envName;
  return (
    <div id={id} className="literal-banner" role="note">
      <span className="literal-banner-icon" aria-hidden="true">
        <AlertIcon size={16} />
      </span>
      <div className="literal-banner-text">
        <strong>{label} is stored as plain text</strong>
        <span>Use a {"{{variable}}"} or a secret environment variable instead.</span>
        {onConvert && noEnv && <span className="literal-banner-note">Select an environment to convert it to a variable.</span>}
      </div>
      {onConvert && (
        <button
          type="button"
          className="literal-banner-action"
          onClick={onConvert}
          disabled={noEnv}
          title={noEnv ? "Select an environment first" : `Save it as a secret variable in ${envName}`}
        >
          Convert to variable
        </button>
      )}
    </div>
  );
}
