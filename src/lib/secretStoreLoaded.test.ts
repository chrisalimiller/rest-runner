import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureSecretStore, createFakeBackend, initSecretStore, isLoaded, resetSecretStoreForTests, setBackend, subscribe, type FakeBackend } from "./secretStore";

let fake: FakeBackend;

beforeEach(() => {
  resetSecretStoreForTests();
  fake = createFakeBackend();
  setBackend(fake);
  configureSecretStore({ retryDelaysMs: [1, 1, 1] });
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isLoaded", () => {
  it("is false before the first load attempt and true after it succeeds", async () => {
    expect(isLoaded()).toBe(false);
    await initSecretStore();
    expect(isLoaded()).toBe(true);
  });

  it("is true after a failed attempt so inputs work session-only", async () => {
    fake.unavailable = "no keychain";
    expect(await initSecretStore()).toBe("unavailable");
    expect(isLoaded()).toBe(true);
  });

  it("is true in the browser fallback and notifies subscribers", async () => {
    vi.unstubAllGlobals();
    const seen = vi.fn();
    subscribe(seen);
    await initSecretStore();
    expect(isLoaded()).toBe(true);
    expect(seen).toHaveBeenCalled();
  });
});
