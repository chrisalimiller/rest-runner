import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLECTIONS_KEY } from "./collections";
import { ENVIRONMENTS_KEY, type Environment } from "./environments";
import {
  HISTORY_KEY,
  installStorageRedaction,
  redactCollectionsForStorage,
  redactForStorage,
  resetScrubLaunchForTests,
  scrubOncePerLaunch,
  shortSecretVariables,
  uninstallStorageRedaction,
} from "./redactStorage";
import { SECRET_MASK } from "./secrets";
import { configureSecretStore, createFakeBackend, initSecretStore, resetSecretStoreForTests, setBackend, setSecrets, status, whenFlushed } from "./secretStore";
import { getMigrationResult, resetMigrationForTests, runSecretsMigration, SECRETS_MIGRATED_KEY } from "./secretsMigration";
import { migrationNotice } from "./secretsUi";
import { load, save } from "./storage";
import { toWorkspaceFile } from "./workspace";

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
const SECRET = "sup3r-secret-token";

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  resetSecretStoreForTests();
  resetMigrationForTests();
  resetScrubLaunchForTests();
  setBackend(createFakeBackend());
  configureSecretStore({ retryDelaysMs: [1, 1, 1] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  uninstallStorageRedaction();
});

describe("browser (dev) mode migration", () => {
  it("is a no-op: plain secrets stay in local storage and nothing is reported as moved", async () => {
    vi.stubGlobal("window", {});
    expect(await initSecretStore()).toBe("browser-fallback");
    localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify([env("e1", [row("v1", "token", SECRET, true)])]));
    const result = await runSecretsMigration();
    expect(result).toEqual({ migrated: 0, failed: false });
    expect(getMigrationResult()).toEqual(result);
    expect(localStorage.getItem(ENVIRONMENTS_KEY)).toContain(SECRET);
    expect(localStorage.getItem(SECRETS_MIGRATED_KEY)).toBeNull();
    expect(status()).toBe("browser-fallback");
    expect(migrationNotice(result, false)).toBeNull();
  });

  it("still migrates when the keychain is ready", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    await initSecretStore();
    localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify([env("e1", [row("v1", "token", SECRET, true)])]));
    expect((await runSecretsMigration()).migrated).toBe(1);
    expect(localStorage.getItem(ENVIRONMENTS_KEY)).not.toContain(SECRET);
  });
});

describe("scrub once per launch", () => {
  const history = () => JSON.stringify([{ id: "h1", url: `https://x/?t=${SECRET}`, def: { url: "{{base}}" } }]);

  it("scrubs old copies when the store is ready, once, without a migration", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    await initSecretStore();
    setSecrets("e1", { v1: SECRET });
    await whenFlushed();
    localStorage.setItem(HISTORY_KEY, history());
    expect(scrubOncePerLaunch()).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(localStorage.getItem(HISTORY_KEY)).not.toContain(SECRET);
    expect(localStorage.getItem(HISTORY_KEY)).toContain("{{base}}");
    expect(scrubOncePerLaunch()).toBe(false);
  });

  it("does nothing in browser mode or with no secrets", async () => {
    vi.stubGlobal("window", {});
    await initSecretStore();
    localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify([env("e1", [row("v1", "token", SECRET, true)])]));
    expect(scrubOncePerLaunch()).toBe(false);
    resetSecretStoreForTests();
    setBackend(createFakeBackend());
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    await initSecretStore();
    localStorage.removeItem(ENVIRONMENTS_KEY);
    expect(scrubOncePerLaunch()).toBe(false);
  });
});

describe("saved example responses", () => {
  const sample = (body: string) => ({ status: 200, statusText: "OK", headers: [["X-Echo", body]] as [string, string][], body });
  const req = (id: string) => ({ id, name: `uses ${SECRET}`, method: "GET", url: "{{base}}/x", params: [], headers: [], bodyMode: "none", body: "", formBody: [], auth: { type: "none" } });
  const tree = () => [
    {
      id: "c1",
      name: "C",
      items: [
        { kind: "folder", id: "f1", name: "F", items: [{ kind: "request", id: "r2", request: req("r2"), examples: [{ id: "x2", name: "ex", request: req("x2"), response: sample(`t=${SECRET}`) }] }] },
        { kind: "request", id: "r1", request: req("r1"), examples: [{ id: "x1", name: "ex", request: req("x1"), response: sample(`t=${SECRET}`) }, { id: "x3", name: "no response", request: req("x3") }] },
      ],
    },
  ];

  it("redacts only examples[].response, at any depth", () => {
    const out = redactCollectionsForStorage(tree(), [SECRET]) as ReturnType<typeof tree>;
    const text = JSON.stringify(out);
    const r1 = out[0].items[1] as unknown as { request: unknown; examples: { response?: { body: string; headers: string[][] } }[] };
    expect(r1.examples[0].response?.body).toBe(`t=${SECRET_MASK}`);
    expect(r1.examples[0].response?.headers[0][1]).toBe(`t=${SECRET_MASK}`);
    expect(r1.examples[1].response).toBeUndefined();
    const nested = (out[0].items[0] as unknown as { items: { examples: { response: { body: string } }[] }[] }).items[0].examples[0].response.body;
    expect(nested).toBe(`t=${SECRET_MASK}`);
    // Names and request definitions (with their placeholders) are untouched.
    expect(text).toContain(`uses ${SECRET}`);
    expect(JSON.stringify(r1.request)).toBe(JSON.stringify(req("r1")));
    expect(text).toContain("{{base}}/x");
  });

  it("is applied on save, without changing the caller's data", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    await initSecretStore();
    setSecrets("e1", { v1: SECRET });
    installStorageRedaction();
    const data = tree();
    expect(save(COLLECTIONS_KEY, data)).toBe(true);
    const stored = localStorage.getItem(COLLECTIONS_KEY) ?? "";
    expect(stored).toContain(SECRET_MASK);
    expect(stored.match(new RegExp(SECRET, "g"))?.length).toBe(5); // the request names only
    expect(JSON.stringify(data)).toContain(`t=${SECRET}`);
    expect(load<unknown[]>(COLLECTIONS_KEY, [])).toHaveLength(1);
  });

  it("is applied to workspace exports unless secrets are included", () => {
    const envs = [env("e1", [row("v1", "token", SECRET, true)])];
    const out = toWorkspaceFile(tree() as never, envs);
    expect(out).toContain(SECRET_MASK);
    expect(out).not.toContain(`t=${SECRET}`);
    expect(out).toContain("{{base}}/x");
    expect(toWorkspaceFile(tree() as never, envs, { includeSecrets: true })).toContain(`t=${SECRET}`);
  });

  it("passes non-array and secret-free data through", () => {
    expect(redactCollectionsForStorage("x", [SECRET])).toBe("x");
    const t = tree();
    expect(redactCollectionsForStorage(t, [])).toBe(t);
  });
});

describe("redaction gaps", () => {
  it("lists secret variables too short to be redacted", () => {
    const envs = [env("e1", [row("a", "pin", "123", true), row("b", "tok", "long-enough", true), row("c", "plain", "1"), row("d", "empty", "", true)])];
    expect(shortSecretVariables(envs)).toEqual([{ envId: "e1", envName: "e1", varId: "a", name: "pin" }]);
  });

  it("default secrets include plain secret values still in environments when the store has none", () => {
    localStorage.setItem(ENVIRONMENTS_KEY, JSON.stringify([env("e1", [row("v1", "token", SECRET, true)])]));
    expect(redactForStorage({ body: `x ${SECRET}` })).toEqual({ body: `x ${SECRET_MASK}` });
  });
});
