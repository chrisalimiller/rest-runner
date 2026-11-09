import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENVIRONMENTS_KEY, loadEnvironments, saveEnvironments, type Environment } from "./environments";
import { redactReport, storedSecrets } from "./secrets";
import { configureSecretStore, createFakeBackend, getSecret, initSecretStore, resetSecretStoreForTests, retry, setBackend, whenFlushed, type FakeBackend } from "./secretStore";
import { getMigrationResult, resetMigrationForTests, runSecretsMigration, SECRETS_MIGRATED_KEY, subscribeMigration } from "./secretsMigration";
import { exportEnvironments, importWorkspaceFile } from "./workspace";
import { writeWorkspace } from "./workspaceStore";

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

let fake: FakeBackend;

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  resetSecretStoreForTests();
  resetMigrationForTests();
  fake = createFakeBackend();
  setBackend(fake);
  configureSecretStore({ retryDelaysMs: [1, 1, 1] });
});

afterEach(() => vi.unstubAllGlobals());

describe("environments with the secret store", () => {
  it("hydrates secret values from the store, keyed by env and var id", async () => {
    fake.data.set("e1", JSON.stringify({ v1: "tok-1" }));
    await initSecretStore();
    putRaw([env("e1", [row("v1", "token", "", true), row("v2", "host", "h")])]);
    const [e] = loadEnvironments();
    expect(e.vars.map((v) => v.value)).toEqual(["tok-1", "h"]);
    expect(e.vars[0].secret).toBe(true);
  });

  it("saveEnvironments keeps secrets out of localStorage and never mutates its input", async () => {
    await initSecretStore();
    const envs = [env("e1", [row("v1", "token", "sup3r-secret", true), row("v2", "host", "plain")])];
    expect(saveEnvironments(envs)).toBe(true);
    expect(raw()).not.toContain("sup3r-secret");
    expect(raw()).toContain("plain");
    expect(JSON.parse(raw())[0].vars[0].secret).toBe(true);
    expect(envs[0].vars[0].value).toBe("sup3r-secret");
    await whenFlushed();
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ v1: "sup3r-secret" });
    expect(loadEnvironments()[0].vars[0].value).toBe("sup3r-secret");
  });

  it("never writes secrets to localStorage when the keychain is unavailable (session only)", async () => {
    fake.failReads = true;
    await initSecretStore();
    saveEnvironments([env("e1", [row("v1", "token", "sess-secret", true)])]);
    expect(raw()).not.toContain("sess-secret");
    expect(loadEnvironments()[0].vars[0].value).toBe("sess-secret");
  });

  it("removes the stored value when a secret is unflagged, emptied or its variable deleted", async () => {
    await initSecretStore();
    loadEnvironments(); // the state was hydrated after the keychain read
    saveEnvironments([env("e1", [row("a", "a", "A", true), row("b", "b", "B", true), row("c", "c", "C", true)])]);
    await whenFlushed();
    saveEnvironments([env("e1", [row("a", "a", "A", false), row("b", "b", "", true)])]);
    await whenFlushed();
    expect(getSecret("e1", "a")).toBe("");
    expect(getSecret("e1", "b")).toBe("");
    expect(getSecret("e1", "c")).toBe("");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({});
    // the unflagged value is now an ordinary variable
    expect(raw()).toContain('"value":"A"');
  });

  it("renaming a variable keeps its value (ids are stable)", async () => {
    await initSecretStore();
    saveEnvironments([env("e1", [row("a", "old", "A", true)])]);
    saveEnvironments([env("e1", [row("a", "new", "A", true)])]);
    await whenFlushed();
    expect(loadEnvironments()[0].vars[0]).toMatchObject({ key: "new", value: "A" });
  });

  it("deleting an environment removes its keychain entry", async () => {
    await initSecretStore();
    saveEnvironments([env("e1", [row("a", "a", "A", true)]), env("e2", [row("a", "a", "B", true)])]);
    await whenFlushed();
    saveEnvironments([env("e2", [row("a", "a", "B", true)])]);
    await whenFlushed();
    expect(fake.data.has("e1")).toBe(false);
    expect(fake.data.has("e2")).toBe(true);
  });

  it("writeWorkspace routes environments through the store", async () => {
    await initSecretStore();
    expect(writeWorkspace({ collections: [], environments: [env("e1", [row("a", "a", "ws-secret", true)])], suites: [], flows: [] })).toBe(true);
    expect(raw()).not.toContain("ws-secret");
    expect(getSecret("e1", "a")).toBe("ws-secret");
  });
});

describe("export and import with hydrated environments", () => {
  it("exports without secrets unless asked", () => {
    const envs = [env("e1", [row("a", "a", "S", true), row("b", "b", "P")])];
    expect(exportEnvironments(envs, false)[0].vars.map((v) => v.value)).toEqual(["", "P"]);
    expect(exportEnvironments(envs, true)[0].vars.map((v) => v.value)).toEqual(["S", "P"]);
    expect(envs[0].vars[0].value).toBe("S");
  });

  it("an import without secret values keeps the hydrated local value", async () => {
    await initSecretStore();
    saveEnvironments([env("e1", [row("a", "token", "mine", true)])]);
    const file = JSON.stringify({ app: "rest-runner", kind: "workspace", version: 4, collections: [], environments: [env("e1", [row("a", "token", "", true)])] });
    const r = importWorkspaceFile(file, [], loadEnvironments());
    expect(r.environments[0].vars[0].value).toBe("mine");
  });
});

describe("storedSecrets", () => {
  it("masks store values and redactReport uses them", async () => {
    await initSecretStore();
    saveEnvironments([env("e1", [row("a", "a", "mask-me-123", true)])]);
    expect(storedSecrets()).toContain("mask-me-123");
    expect(JSON.stringify(redactReport({ body: "x mask-me-123 y" }, storedSecrets()))).not.toContain("mask-me-123");
  });
});

describe("migration", () => {
  const legacy = () => putRaw([env("e1", [row("a", "a", "plain-1", true), row("b", "b", "keep")]), env("e2", [row("a", "a", "plain-2", true)])]);

  it("moves plain secrets into the keychain, then blanks localStorage", async () => {
    legacy();
    await initSecretStore();
    const seen: number[] = [];
    subscribeMigration(() => seen.push(1));
    const r = await runSecretsMigration();
    expect(r).toEqual({ migrated: 2, failed: false });
    expect(getMigrationResult()).toEqual(r);
    expect(seen.length).toBe(1);
    expect(raw()).not.toContain("plain-1");
    expect(raw()).not.toContain("plain-2");
    expect(raw()).toContain("keep");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ a: "plain-1" });
    expect(JSON.parse(fake.data.get("e2")!)).toEqual({ a: "plain-2" });
    expect(localStorage.getItem(SECRETS_MIGRATED_KEY)).toBe("true");
    expect(loadEnvironments()[0].vars[0].value).toBe("plain-1");
  });

  it("is idempotent", async () => {
    legacy();
    await initSecretStore();
    await runSecretsMigration();
    const before = raw();
    const writes = fake.writes.length;
    expect(await runSecretsMigration()).toEqual({ migrated: 0, failed: false });
    expect(raw()).toBe(before);
    expect(fake.writes.length).toBe(writes);
  });

  it("leaves localStorage untouched when the keychain write fails, and converges next time", async () => {
    legacy();
    await initSecretStore();
    const before = raw();
    fake.failWrites = true;
    expect(await runSecretsMigration()).toEqual({ migrated: 0, failed: true });
    expect(raw()).toBe(before);
    expect(localStorage.getItem(SECRETS_MIGRATED_KEY)).toBeNull();
    fake.failWrites = false;
    await retry();
    await whenFlushed();
    expect(await runSecretsMigration()).toMatchObject({ failed: false });
    expect(raw()).not.toContain("plain-1");
  });

  it("converges when the scrub is interrupted after the keychain write", async () => {
    legacy();
    await initSecretStore();
    const set = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error("quota");
    };
    expect(await runSecretsMigration()).toEqual({ migrated: 0, failed: true });
    expect(raw()).toContain("plain-1");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ a: "plain-1" });
    localStorage.setItem = set;
    expect(await runSecretsMigration()).toMatchObject({ failed: false });
    expect(raw()).not.toContain("plain-1");
  });

  it("keeps the keychain value when it already holds one", async () => {
    legacy();
    fake.data.set("e1", JSON.stringify({ a: "from-keychain" }));
    await initSecretStore();
    await runSecretsMigration();
    expect(getSecret("e1", "a")).toBe("from-keychain");
    expect(JSON.parse(fake.data.get("e1")!)).toEqual({ a: "from-keychain" });
    expect(raw()).not.toContain("plain-1");
  });

  it("does nothing, and reports failure, when the keychain is unavailable", async () => {
    legacy();
    fake.failReads = true;
    await initSecretStore();
    const before = raw();
    expect(await runSecretsMigration()).toEqual({ migrated: 0, failed: true });
    expect(raw()).toBe(before);
    expect(loadEnvironments()[0].vars[0].value).toBe("plain-1");
  });

  it("reports nothing to do for a clean install", async () => {
    await initSecretStore();
    expect(await runSecretsMigration()).toEqual({ migrated: 0, failed: false });
  });
});
