import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanEnvironments, ENVIRONMENTS_KEY, loadEnvironments, mergeHydrated, onSecretsHydrated, saveEnvironments, type Environment } from "./environments";
import {
  configureSecretStore, createFakeBackend, deleteEnv, getSecret, hydrationEpoch, initSecretStore, isHydrated, isPersisted, removeSecrets,
  resetSecretStoreForTests, retry, setBackend, setSecrets, status, whenFlushed, type FakeBackend,
} from "./secretStore";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
const row = (id: string, key: string, value: string, secret?: boolean) => ({ id, key, value, enabled: true, ...(secret ? { secret } : {}) });
const env = (id: string, vars: ReturnType<typeof row>[]): Environment => ({ id, name: id, vars, color: "none" });
const raw = () => localStorage.getItem(ENVIRONMENTS_KEY) ?? "";
const putRaw = (envs: Environment[]) => localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify(envs));
const tick = () => new Promise((r) => setTimeout(r, 5));

let fake: FakeBackend;
beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  resetSecretStoreForTests();
  fake = createFakeBackend();
  setBackend(fake);
  configureSecretStore({ retryDelaysMs: [1, 1, 1], timeoutMs: 20 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("P0-1 late keychain load", () => {
  it("a late load re-hydrates state without clobbering edits, and the next save keeps the secret", async () => {
    fake.data.set("e1", JSON.stringify({ a: "KEYCHAIN" }));
    putRaw([env("e1", [row("a", "tok", "", true), row("b", "host", "h")])]);
    let release!: () => void;
    const realList = fake.listEnvs;
    fake.listEnvs = () => new Promise((res) => (release = () => res(realList())));
    await initSecretStore(); // times out
    expect(isHydrated()).toBe(false);
    let state = loadEnvironments();
    expect(state[0].vars[0].value).toBe("");
    state = [{ ...state[0], name: "renamed" }];
    saveEnvironments(state);
    await tick();
    expect(fake.writes).toEqual([]);
    let reloads = 0;
    const off = onSecretsHydrated(() => {
      reloads++;
      state = mergeHydrated(state, loadEnvironments());
    });
    release();
    await tick();
    off();
    expect(reloads).toBeGreaterThan(0);
    expect(state[0].name).toBe("renamed");
    expect(state[0].vars[0].value).toBe("KEYCHAIN");
    saveEnvironments(state);
    await whenFlushed();
    expect(getSecret("e1", "a")).toBe("KEYCHAIN");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ a: "KEYCHAIN" });
  });

  it("an empty value from a never-hydrated state never deletes a stored secret, even after the load", async () => {
    fake.data.set("e1", JSON.stringify({ a: "KEYCHAIN" }));
    putRaw([env("e1", [row("a", "tok", "", true)])]);
    fake.failReads = true;
    await initSecretStore();
    const stale = loadEnvironments();
    fake.failReads = false;
    await retry();
    expect(hydrationEpoch()).toBe(1);
    saveEnvironments([{ ...stale[0], name: "x" }]);
    await whenFlushed();
    expect(getSecret("e1", "a")).toBe("KEYCHAIN");
    expect(fake.writes.filter((w) => w.op === "delete")).toEqual([]);
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ a: "KEYCHAIN" });
  });

  it("mergeHydrated fills blank secrets only and keeps user structure and non-empty values", () => {
    const cur = [env("e1", [row("a", "t", "", true), row("b", "u", "typed", true), row("n", "new", "")])];
    const fresh = [env("e1", [row("a", "t", "S", true), row("b", "u", "OLD", true)]), env("e2", [row("z", "z", "")])];
    const m = mergeHydrated(cur, fresh);
    expect(m.map((e) => e.id)).toEqual(["e1"]);
    expect(m[0].vars.map((v) => v.value)).toEqual(["S", "typed", ""]);
    expect(mergeHydrated(m, fresh)).toBe(m);
  });

  it("clearing a secret in a hydrated state still deletes it", async () => {
    fake.data.set("e1", JSON.stringify({ a: "S" }));
    await initSecretStore();
    putRaw([env("e1", [row("a", "t", "", true)])]);
    const s = loadEnvironments();
    saveEnvironments([{ ...s[0], vars: [{ ...s[0].vars[0], value: "" }] }]);
    await whenFlushed();
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({});
  });

  it("onSecretsHydrated fires right away when the load finished after the state was loaded", async () => {
    putRaw([env("e1", [row("a", "t", "", true)])]);
    loadEnvironments();
    await initSecretStore();
    const cb = vi.fn();
    onSecretsHydrated(cb)();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("P1-1 plain text only blanked after confirmation", () => {
  it("keeps the on-disk plain value while the keychain write is unconfirmed, then blanks it", async () => {
    putRaw([env("e1", [row("a", "t", "plain", true)])]);
    await initSecretStore();
    saveEnvironments(loadEnvironments());
    expect(raw()).toContain("plain");
    await whenFlushed();
    await tick();
    expect(isPersisted("e1", "a", "plain")).toBe(true);
    expect(raw()).not.toContain("plain");
  });

  it("keeps the plain value when the keychain write fails", async () => {
    putRaw([env("e1", [row("a", "t", "plain", true)])]);
    await initSecretStore();
    fake.failWrites = true;
    saveEnvironments(loadEnvironments());
    await whenFlushed();
    await tick();
    expect(status()).toBe("unsaved");
    expect(raw()).toContain("plain");
  });

  it("never writes a new plain value, and keeps the old one in unavailable mode", async () => {
    putRaw([env("e1", [row("a", "t", "old", true), row("b", "u", "", true)])]);
    fake.unavailable = "locked";
    await initSecretStore();
    const s = loadEnvironments();
    saveEnvironments([{ ...s[0], vars: [{ ...s[0].vars[0], value: "newer" }, { ...s[0].vars[1], value: "brand-new" }] }]);
    expect(raw()).toContain("old");
    expect(raw()).not.toContain("newer");
    expect(raw()).not.toContain("brand-new");
  });

  it("dev browser keeps plain values in localStorage", () => {
    vi.unstubAllGlobals();
    saveEnvironments([env("e1", [row("a", "t", "visible", true)])]);
    expect(raw()).toContain("visible");
    expect(loadEnvironments()[0].vars[0].value).toBe("visible");
  });
});

describe("P1-2 unsaved retries", () => {
  it("re-pumps with backoff while unsaved and recovers", async () => {
    configureSecretStore({ repumpDelaysMs: [10] });
    await initSecretStore();
    fake.failWrites = true;
    setSecrets("e1", { a: "S" });
    await whenFlushed();
    expect(status()).toBe("unsaved");
    fake.failWrites = false;
    await new Promise((r) => setTimeout(r, 40));
    await whenFlushed();
    expect(status()).toBe("ready");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ a: "S" });
  });

  it("retry() pumps without re-reading over unsaved edits", async () => {
    fake.data.set("e1", JSON.stringify({ a: "OLD" }));
    await initSecretStore();
    fake.failWrites = true;
    setSecrets("e1", { a: "NEW" });
    await whenFlushed();
    fake.failWrites = false;
    await retry();
    await whenFlushed();
    expect(getSecret("e1", "a")).toBe("NEW");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ a: "NEW" });
    expect(status()).toBe("ready");
  });
});

describe("pump regression", () => {
  it("retry() with nothing dirty does not block later pumps", async () => {
    await initSecretStore();
    await retry();
    setSecrets("e1", { a: "S" });
    await whenFlushed();
    expect(fake.data.get("e1")).toBeDefined();
  });
});

describe("corrupt stored item", () => {
  it("fails the load visibly and writes nothing", async () => {
    fake.data.set("e1", "{not json");
    await initSecretStore();
    expect(status()).toBe("unavailable");
    expect(isHydrated()).toBe(false);
    setSecrets("e1", { a: "S" });
    await tick();
    expect(fake.writes).toEqual([]);
    expect(fake.data.get("e1")).toBe("{not json");
  });
});

describe("edits made before the load", () => {
  it("deleting an env before load deletes its keychain item afterwards", async () => {
    fake.data.set("gone", JSON.stringify({ a: "S" }));
    fake.failReads = true;
    await initSecretStore();
    deleteEnv("gone");
    fake.failReads = false;
    await retry();
    await whenFlushed();
    expect(fake.data.has("gone")).toBe(false);
  });

  it("clearing a secret before load is applied after it (not resurrected)", async () => {
    fake.data.set("e1", JSON.stringify({ a: "S", b: "T" }));
    fake.failReads = true;
    await initSecretStore();
    removeSecrets("e1", ["a"]);
    fake.failReads = false;
    await retry();
    await whenFlushed();
    expect(getSecret("e1", "a")).toBe("");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ b: "T" });
  });

  it("removing a variable in an unhydrated state clears it after load", async () => {
    fake.data.set("e1", JSON.stringify({ a: "S", b: "T" }));
    putRaw([env("e1", [row("a", "x", "", true), row("b", "y", "", true)])]);
    fake.failReads = true;
    await initSecretStore();
    saveEnvironments([env("e1", [row("b", "y", "", true)])]);
    fake.failReads = false;
    await retry();
    await whenFlushed();
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ b: "T" });
  });
});

describe("variable ids", () => {
  it("assigns unique ids to missing or duplicate ids, deterministically and idempotently", () => {
    const input = [{ id: "e1", name: "n", vars: [{ key: "a", value: "", enabled: true }, { id: "x", key: "b", value: "", enabled: true }, { id: "x", key: "c", value: "", enabled: true }, { id: "", key: "d", value: "", enabled: true }] }];
    const a = cleanEnvironments(input);
    const ids = a[0].vars.map((v) => v.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((i) => i && i !== "undefined")).toBe(true);
    expect(cleanEnvironments(input)[0].vars.map((v) => v.id)).toEqual(ids);
    expect(cleanEnvironments(a)[0].vars.map((v) => v.id)).toEqual(ids);
  });
});
