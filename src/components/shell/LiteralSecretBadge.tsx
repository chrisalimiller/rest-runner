import "./shell.css";

export const LITERAL_SECRET_HINT = "Stored as plain text. Use a secret variable to keep it in the keychain.";

/** Warn-only mark beside a field that holds a credential typed in plain text. Point the field's aria-describedby at `id`. */
export function LiteralSecretBadge({ id }: { id: string }) {
  return (
    <span id={id} className="chip warn literal-badge" title={LITERAL_SECRET_HINT} aria-label={LITERAL_SECRET_HINT} tabIndex={0}>
      Plain text
    </span>
  );
}
