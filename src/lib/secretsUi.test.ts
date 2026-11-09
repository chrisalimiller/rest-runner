import { describe, expect, it } from "vitest";
import { newEnvironment } from "./environments";
import { hasSecretVars, keychainNote, migrationNotice, secretInputsDisabled, secretStatusMessage, shouldShowBanner, statusOffersRetry } from "./secretsUi";
import type { StoreStatus } from "./secretStore";

const none = new Set<StoreStatus>();

describe("secretStatusMessage", () => {
  it("is silent when ready", () => expect(secretStatusMessage("ready")).toBeNull());
  it("has a message for each problem status", () => {
    for (const s of ["unavailable", "denied", "unsaved", "browser-fallback"] as const) expect(secretStatusMessage(s)).toBeTruthy();
    expect(secretStatusMessage("denied")).toContain("denied");
    expect(secretStatusMessage("browser-fallback")).toContain("Dev mode");
  });
  it("offers retry only for unavailable and denied", () => {
    expect(statusOffersRetry("unavailable")).toBe(true);
    expect(statusOffersRetry("denied")).toBe(true);
    expect(statusOffersRetry("unsaved")).toBe(false);
    expect(statusOffersRetry("browser-fallback")).toBe(false);
  });
});

describe("shouldShowBanner", () => {
  it("hides when ready, even with secrets", () => expect(shouldShowBanner("ready", true, none)).toBe(false));
  it("hides when there are no secrets", () => expect(shouldShowBanner("unavailable", false, none)).toBe(false));
  it("shows for a problem status with secrets", () => expect(shouldShowBanner("unavailable", true, none)).toBe(true));
  it("hides a dismissed kind but shows a different one", () => {
    const d = new Set<StoreStatus>(["unavailable"]);
    expect(shouldShowBanner("unavailable", true, d)).toBe(false);
    expect(shouldShowBanner("unsaved", true, d)).toBe(true);
  });
});

describe("hasSecretVars", () => {
  it("finds a secret variable in any environment", () => {
    const a = newEnvironment("A");
    const b = newEnvironment("B");
    expect(hasSecretVars([a, b])).toBe(false);
    b.vars = [{ ...b.vars[0], key: "k", secret: true }];
    expect(hasSecretVars([a, b])).toBe(true);
  });
});

describe("secretInputsDisabled", () => {
  it("disables only before the first load", () => {
    expect(secretInputsDisabled(false)).toBe(true);
    expect(secretInputsDisabled(true)).toBe(false);
  });
});

describe("migrationNotice", () => {
  it("says nothing without a result or with nothing moved", () => {
    expect(migrationNotice(null, false)).toBeNull();
    expect(migrationNotice({ migrated: 0, failed: false }, false)).toBeNull();
  });
  it("announces moved secrets once, singular and plural", () => {
    expect(migrationNotice({ migrated: 1, failed: false }, false)).toEqual({ message: "1 secret value was moved to your system keychain.", markSeen: true, scrub: true });
    expect(migrationNotice({ migrated: 3, failed: false }, false)?.message).toBe("3 secret values were moved to your system keychain.");
  });
  it("does not repeat the toast once seen but still scrubs", () => {
    expect(migrationNotice({ migrated: 2, failed: false }, true)).toEqual({ message: null, markSeen: false, scrub: true });
  });
  it("reports a failure every launch without scrubbing", () => {
    const n = migrationNotice({ migrated: 0, failed: true }, true);
    expect(n?.message).toContain("couldn't be moved");
    expect(n?.scrub).toBe(false);
    expect(n?.markSeen).toBe(false);
  });
});

describe("keychainNote", () => {
  it("names the platform store", () => {
    expect(keychainNote("MacIntel")).toContain("macOS Keychain");
    expect(keychainNote("Win32")).toContain("Windows Credential Manager");
    expect(keychainNote("Linux x86_64")).toContain("system keychain");
  });
});
