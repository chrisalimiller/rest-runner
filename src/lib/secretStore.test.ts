import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allValues,
  configureSecretStore,
  createFakeBackend,
  deleteEnv,
  getEnvSecrets,
  getSecret,
  initSecretStore,
  lastError,
  removeSecrets,
  resetSecretStoreForTests,
  retry,
  setBackend,
  setSecrets,
  status,
  subscribe,
  whenFlushed,
  type FakeBackend,
} from "./secretStore";

function tauri() {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
}

let fake: FakeBackend;

beforeEach(() => {
  resetSecretStoreForTests();
  fake = createFakeBackend();
  setBackend(fake);
  configureSecretStore({ retryDelaysMs: [1, 1, 1] });
  tauri();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("native mode", () => {
  it("hydrates the cache from the backend", async () => {
    fake.data.set("e1", JSON.stringify({ v1: "s3cret", v2: "" }));
    expect(await initSecretStore()).toBe("ready");
    expect(getSecret("e1", "v1")).toBe("s3cret");
    expect(getSecret("e1", "missing")).toBe("");
    expect(getEnvSecrets("e1")).toEqual({ v1: "s3cret", v2: "" });
    expect(allValues()).toEqual(["s3cret"]);
  });

  it("returns the same promise for a double init (StrictMode)", async () => {
    const a = initSecretStore();
    const b = initSecretStore();
    expect(a).toBe(b);
    await a;
  });

  it("updates the cache synchronously and writes through", async () => {
    await initSecretStore();
    setSecrets("e1", { v1: "a" });
    expect(getSecret("e1", "v1")).toBe("a");
    await whenFlushed();
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ v1: "a" });
    removeSecrets("e1", ["v1"]);
    await whenFlushed();
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({});
  });

  it("coalesces rapid edits and serializes writes", async () => {
    await initSecretStore();
    let active = 0;
    let maxActive = 0;
    const real = fake.writeEnv;
    fake.writeEnv = async (id, json) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      await real(id, json);
      active--;
    };
    setSecrets("e1", { v1: "1" });
    setSecrets("e1", { v1: "2" });
    setSecrets("e1", { v1: "3" });
    setSecrets("e2", { v1: "x" });
    await whenFlushed();
    expect(maxActive).toBe(1);
    const e1Writes = fake.writes.filter((w) => w.envId === "e1");
    expect(e1Writes.length).toBeLessThanOrEqual(2);
    expect(JSON.parse(e1Writes.at(-1)!.json!)).toEqual({ v1: "3" });
    expect(fake.data.has("e2")).toBe(true);
  });

  it("deleteEnv removes the cache entry and the stored data", async () => {
    fake.data.set("e1", JSON.stringify({ v1: "a" }));
    await initSecretStore();
    deleteEnv("e1");
    expect(getEnvSecrets("e1")).toEqual({});
    await whenFlushed();
    expect(fake.data.has("e1")).toBe(false);
  });

  it("retries a failing write, then reports unsaved and recovers on retry()", async () => {
    await initSecretStore();
    fake.failWrites = true;
    const spy = vi.spyOn(fake, "writeEnv");
    setSecrets("e1", { v1: "a" });
    await whenFlushed();
    expect(spy).toHaveBeenCalledTimes(4); // first try + 3 retries
    expect(status()).toBe("unsaved");
    expect(lastError()).toBe("write failed");
    expect(getSecret("e1", "v1")).toBe("a");
    fake.failWrites = false;
    await retry();
    await whenFlushed();
    expect(status()).toBe("ready");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ v1: "a" });
  });

  it("never writes before the first load succeeded", async () => {
    fake.failReads = true;
    fake.data.set("e1", JSON.stringify({ v1: "keep" }));
    expect(await initSecretStore()).toBe("unavailable");
    setSecrets("e1", { v1: "" });
    setSecrets("e2", { v1: "x" });
    deleteEnv("e3");
    await whenFlushed();
    expect(fake.writes).toEqual([]);
    expect(fake.data.get("e1")).toBe(JSON.stringify({ v1: "keep" }));
    expect(getSecret("e2", "v1")).toBe("x"); // session-only
    // Once the keychain works, session edits merge over stored values.
    fake.failReads = false;
    expect(await retry()).toBe("ready");
    await whenFlushed();
    expect(JSON.parse(fake.data.get("e2")!)).toEqual({ v1: "x" });
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ v1: "" });
  });

  it("reports denied when the keychain refuses access", async () => {
    fake.unavailable = "User denied access to the keychain";
    expect(await initSecretStore()).toBe("denied");
    expect(lastError()).toMatch(/denied/);
    fake.unavailable = "no secret service";
    expect(await retry()).toBe("unavailable");
  });

  it("times out, then hydrates late and notifies", async () => {
    vi.useFakeTimers();
    configureSecretStore({ timeoutMs: 3000 });
    fake.data.set("e1", JSON.stringify({ v1: "late" }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fake.available = async () => gate;
    const p = initSecretStore();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe("unavailable");
    expect(getSecret("e1", "v1")).toBe("");
    const fn = vi.fn();
    subscribe(fn);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(status()).toBe("ready");
    expect(getSecret("e1", "v1")).toBe("late");
    expect(fn).toHaveBeenCalled();
  });
});

describe("subscribe", () => {
  it("notifies on changes only and can unsubscribe", async () => {
    await initSecretStore();
    const fn = vi.fn();
    const off = subscribe(fn);
    setSecrets("e1", { v1: "a" });
    expect(fn).toHaveBeenCalledTimes(1);
    setSecrets("e1", { v1: "a" });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setSecrets("e1", { v1: "b" });
    expect(fn).toHaveBeenCalledTimes(1);
    await whenFlushed();
  });
});

describe("browser fallback", () => {
  function fakeSession() {
    const store = new Map<string, string>();
    const local = { getItem: vi.fn(), setItem: vi.fn() };
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("localStorage", local);
    return { store, local };
  }

  it("persists to sessionStorage only and never touches the backend or localStorage", async () => {
    const { store, local } = fakeSession();
    expect(await initSecretStore()).toBe("browser-fallback");
    setSecrets("e1", { v1: "dev" });
    await whenFlushed();
    expect(JSON.parse(store.get("rest-runner.dev-secrets")!)).toEqual({ e1: { v1: "dev" } });
    expect(fake.writes).toEqual([]);
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("restores from sessionStorage and survives missing storage", async () => {
    const { store } = fakeSession();
    store.set("rest-runner.dev-secrets", JSON.stringify({ e1: { v1: "back" } }));
    await initSecretStore();
    expect(getSecret("e1", "v1")).toBe("back");

    resetSecretStoreForTests();
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(await initSecretStore()).toBe("browser-fallback");
    setSecrets("e1", { v1: "mem" });
    expect(getSecret("e1", "v1")).toBe("mem");
  });
});
