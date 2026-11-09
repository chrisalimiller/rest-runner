import type { Environment } from "./environments";
import type { MigrationResult } from "./secretsMigration";
import type { StoreStatus } from "./secretStore";

/** What the user is told for each store status. `ready` has nothing to say. */
export function secretStatusMessage(status: StoreStatus): string | null {
  switch (status) {
    case "unavailable":
      return "The system keychain isn't available, so secret values can't be loaded or saved. Secret values are read-only until it is available; retry once it is.";
    case "denied":
      return "Access to the system keychain was denied. Allow it in your system settings, then retry.";
    case "unsaved":
      return "Some secret values haven't been saved to the keychain yet. We'll keep trying.";
    case "browser-fallback":
      return "Dev mode: secret values are kept for this browser tab only.";
    default:
      return null;
  }
}

/** Retry helps when the keychain is the problem, and for values that could not be written yet. */
export function statusOffersRetry(status: StoreStatus): boolean {
  return status === "unavailable" || status === "denied" || status === "unsaved";
}

/** True when any environment has a variable marked secret. */
export function hasSecretVars(environments: readonly Environment[]): boolean {
  return environments.some((e) => e.vars.some((v) => v.secret === true));
}

/** Banner rule: stay quiet when all is well, when nobody has secrets, or after the user dismissed this kind of notice. */
export function shouldShowBanner(status: StoreStatus, hasSecrets: boolean, dismissed: ReadonlySet<StoreStatus>): boolean {
  return secretStatusMessage(status) !== null && hasSecrets && !dismissed.has(status);
}

/** Secret value inputs stay read-only until the keychain has been read (hydrated), so nothing is edited blind. */
export function secretInputsDisabled(hydrated: boolean): boolean {
  return !hydrated;
}

export const SECRETS_NOTICE_SEEN_KEY = "rest-runner.secrets-notice-seen";

export interface MigrationNotice {
  /** The toast text, or null when it was already shown on this install. */
  message: string | null;
  /** Remember that the "moved" notice was shown. */
  markSeen: boolean;
  /** Mask old copies in history, tabs and saved runs. */
  scrub: boolean;
}

/** What to do for a migration result. The success toast shows once per install; a failure shows each launch. */
export function migrationNotice(result: MigrationResult | null, seen: boolean): MigrationNotice | null {
  if (!result) return null;
  if (result.failed) return { message: "Some secret values couldn't be moved to your system keychain. They'll be tried again next launch.", markSeen: false, scrub: false };
  if (result.migrated > 0) {
    const n = result.migrated;
    const text = n === 1 ? "1 secret value was moved to your system keychain." : `${n} secret values were moved to your system keychain.`;
    return { message: seen ? null : text, markSeen: !seen, scrub: true };
  }
  return null;
}

/** Where the About dialog says secrets live. */
export function keychainName(platform: string): string {
  if (/Mac/i.test(platform)) return "the macOS Keychain";
  if (/Win/i.test(platform)) return "Windows Credential Manager";
  return "your system keychain";
}

export function keychainNote(platform: string): string {
  return `Secret variable values are stored in ${keychainName(platform)}.`;
}
