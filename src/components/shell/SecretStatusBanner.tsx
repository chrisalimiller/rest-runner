import { useState, useSyncExternalStore } from "react";
import { isHydrated, retry, status, subscribe, type StoreStatus } from "../../lib/secretStore";
import { secretInputsDisabled, secretStatusMessage, shouldShowBanner, statusOffersRetry } from "../../lib/secretsUi";
import { useSidePanels } from "../../lib/sidePanels";
import "./shell.css";

export function useSecretStatus(): StoreStatus {
  return useSyncExternalStore(subscribe, status);
}

/** True while secret value inputs should wait for the keychain to be read. */
export function useSecretInputsDisabled(): boolean {
  return secretInputsDisabled(useSyncExternalStore(subscribe, isHydrated));
}

/** Kinds of notice the user dismissed, per place it is shown. Lasts until the app is closed. */
const dismissed: Record<"panel" | "shell", Set<StoreStatus>> = { panel: new Set(), shell: new Set() };

interface Props {
  /** "panel" sits above the Variables list; "shell" is the slim notice under the top bar. */
  variant: "panel" | "shell";
  /** Whether any secret variable exists. The notice stays quiet without one. */
  hasSecrets: boolean;
}

/** A quiet note when the keychain is not working. Nothing shows when all is well. */
export function SecretStatusBanner({ variant, hasSecrets }: Props) {
  const s = useSecretStatus();
  const panelOpen = useSidePanels().variables;
  const [, bump] = useState(0);
  // The dev-mode note is shown once, under the top bar. Real keychain problems are also in the panel, so the shell one steps aside while it is open.
  if (s === "browser-fallback" && variant === "panel") return null;
  if (variant === "shell" && panelOpen && s !== "browser-fallback") return null;
  if (!shouldShowBanner(s, hasSecrets, dismissed[variant])) return null;
  return (
    <div className={`secret-banner ${variant}`} role="status" aria-live="polite">
      <span className="secret-banner-text">{secretStatusMessage(s)}</span>
      {statusOffersRetry(s) && (
        <button className="link-btn small" onClick={() => void retry()}>
          Retry
        </button>
      )}
      <button
        className="icon-btn secret-banner-close"
        aria-label="Dismiss"
        title="Dismiss for this session"
        onClick={() => {
          dismissed[variant].add(s);
          bump((n) => n + 1);
        }}
      >
        ×
      </button>
    </div>
  );
}
