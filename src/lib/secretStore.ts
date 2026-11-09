import { isTauri } from "./http";
import { createFakeBackend, nativeBackend, type SecretBackend } from "./secretStoreNative";

export { createFakeBackend };
export type { SecretBackend };
export type { FakeBackend } from "./secretStoreNative";

export type StoreStatus = "ready" | "browser-fallback" | "unavailable" | "denied" | "unsaved";

/** Dev-only, per-tab. Secrets are never put in localStorage. */
const SESSION_KEY = "rest-runner.dev-secrets";

let backend: SecretBackend = nativeBackend;
let timeoutMs = 3000;
let retryDelaysMs = [200, 800, 2000];

const cache = new Map<string, Map<string, string>>();
const listeners = new Set<() => void>();
/** Envs edited before the first load succeeded: merged over what the keychain holds. */
const editedBeforeLoad = new Set<string>();
const dirty = new Set<string>();
const deleted = new Set<string>();

let loaded = false;
let browser = false;
let current: StoreStatus = "unavailable";
let error: string | null = null;
let initPromise: Promise<StoreStatus> | null = null;
let loadInFlight: Promise<void> | null = null;
let pumping: Promise<void> | null = null;

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a listener must not break the store */
    }
  }
}

function setStatus(s: StoreStatus, err: string | null = error) {
  if (s === current && err === error) return;
  current = s;
  error = err;
  notify();
}

const message = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

function envMap(envId: string): Map<string, string> {
  let m = cache.get(envId);
  if (!m) cache.set(envId, (m = new Map()));
  return m;
}

// ---- sessionStorage (browser/dev) ----

function saveSession() {
  try {
    const out: Record<string, Record<string, string>> = {};
    for (const [e, m] of cache) out[e] = Object.fromEntries(m);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(out));
  } catch {
    /* storage unavailable: values stay in memory */
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    for (const [e, vars] of Object.entries(parsed)) {
      const m = envMap(e);
      for (const [k, v] of Object.entries(vars)) if (typeof v === "string" && !m.has(k)) m.set(k, v);
    }
  } catch {
    /* ignore */
  }
}

// ---- loading ----

function parseEnv(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const o = JSON.parse(json) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

async function load(): Promise<void> {
  try {
    await backend.available();
    const ids = await backend.listEnvs();
    const stored = new Map<string, Record<string, string>>();
    for (const id of ids) stored.set(id, parseEnv(await backend.readEnv(id)));
    // Hydrate: stored values fill in, values edited this session win.
    for (const [id, vars] of stored) {
      const m = envMap(id);
      const local = editedBeforeLoad.has(id);
      for (const [k, v] of Object.entries(vars)) if (!local || !m.has(k)) m.set(k, v);
    }
    loaded = true;
    for (const id of editedBeforeLoad) dirty.add(id);
    editedBeforeLoad.clear();
    setStatus("ready", null);
    if (dirty.size || deleted.size) pump();
  } catch (e) {
    const msg = message(e);
    setStatus(/denied|cancel|refus|permission|not allowed/i.test(msg) ? "denied" : "unavailable", msg);
  }
}

function startLoad(): Promise<void> {
  loadInFlight ??= load().finally(() => {
    loadInFlight = null;
  });
  return loadInFlight;
}

/** Loads the keychain once; the same promise is returned to every caller until `retry`. */
export function initSecretStore(): Promise<StoreStatus> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!isTauri()) {
      browser = true;
      loadSession();
      loaded = true;
      setStatus("browser-fallback", null);
      return current;
    }
    browser = false;
    const run = startLoad();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((res) => {
      timer = setTimeout(() => res("timeout"), timeoutMs);
    });
    const r = await Promise.race([run.then(() => "done" as const), timedOut]);
    clearTimeout(timer);
    if (r === "timeout" && !loaded) {
      setStatus("unavailable", "The keychain did not respond in time.");
    }
    return current;
  })();
  return initPromise;
}

/** Runs the load again (e.g. after the user unlocked the keychain). */
export function retry(): Promise<StoreStatus> {
  initPromise = null;
  const p = initSecretStore();
  if (loaded && !browser) pump(); // flush anything left unsaved
  return p;
}

// ---- writing ----

async function writeWithRetry(op: () => Promise<void>): Promise<boolean> {
  for (let i = 0; ; i++) {
    try {
      await op();
      return true;
    } catch (e) {
      error = message(e);
      if (i >= retryDelaysMs.length) return false;
      await new Promise((r) => setTimeout(r, retryDelaysMs[i]));
    }
  }
}

/** One serialized loop over all pending envs; the cache is read at write time, so edits coalesce. */
function pump() {
  if (pumping || browser || !loaded) return;
  pumping = (async () => {
    let failed = false;
    const skip = new Set<string>();
    for (;;) {
      const del = [...deleted].find((e) => !skip.has(e));
      const id = del ?? [...dirty].find((e) => !skip.has(e));
      if (id === undefined) break;
      let ok: boolean;
      if (del !== undefined) {
        deleted.delete(id);
        ok = await writeWithRetry(() => backend.deleteEnv(id));
        if (!ok) deleted.add(id);
      } else {
        dirty.delete(id);
        const json = JSON.stringify(Object.fromEntries(cache.get(id) ?? []));
        ok = await writeWithRetry(() => backend.writeEnv(id, json));
        if (!ok) dirty.add(id);
      }
      if (!ok) {
        failed = true;
        skip.add(id);
      }
    }
    pumping = null;
    if (failed) setStatus("unsaved", error);
    else if (current === "unsaved") setStatus("ready", null);
  })();
}

function markDirty(envId: string) {
  if (browser) {
    saveSession();
    return;
  }
  if (!loaded) {
    // Never touch the keychain before a successful read: it could erase stored secrets.
    editedBeforeLoad.add(envId);
    return;
  }
  dirty.add(envId);
  deleted.delete(envId);
  pump();
}

// ---- public API ----

export function getSecret(envId: string, varId: string): string {
  return cache.get(envId)?.get(varId) ?? "";
}

export function getEnvSecrets(envId: string): Record<string, string> {
  return Object.fromEntries(cache.get(envId) ?? []);
}

export function setSecrets(envId: string, entries: Record<string, string>): void {
  const m = envMap(envId);
  let changed = false;
  for (const [k, v] of Object.entries(entries)) {
    if (m.get(k) !== v) {
      m.set(k, v);
      changed = true;
    }
  }
  if (!changed) return;
  markDirty(envId);
  notify();
}

export function removeSecrets(envId: string, varIds?: string[]): void {
  const m = cache.get(envId);
  if (!m) return;
  let changed = false;
  for (const k of varIds ?? [...m.keys()]) changed = m.delete(k) || changed;
  if (!changed) return;
  markDirty(envId);
  notify();
}

export function deleteEnv(envId: string): void {
  cache.delete(envId);
  dirty.delete(envId);
  editedBeforeLoad.delete(envId);
  if (browser) saveSession();
  else if (loaded) {
    deleted.add(envId);
    pump();
  }
  notify();
}

/** Every non-empty secret value, for masking. */
export function allValues(): string[] {
  const out: string[] = [];
  for (const m of cache.values()) for (const v of m.values()) if (v) out.push(v);
  return out;
}

export function status(): StoreStatus {
  return current;
}

export function lastError(): string | null {
  return error;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Resolves once queued writes have finished (or failed). */
export async function whenFlushed(): Promise<void> {
  while (pumping) await pumping;
}

// ---- injection ----

export function setBackend(b: SecretBackend): void {
  backend = b;
}

export function configureSecretStore(opts: { timeoutMs?: number; retryDelaysMs?: number[] }): void {
  if (opts.timeoutMs !== undefined) timeoutMs = opts.timeoutMs;
  if (opts.retryDelaysMs) retryDelaysMs = opts.retryDelaysMs;
}

/** For tests: drops all state and restores defaults. */
export function resetSecretStoreForTests(): void {
  cache.clear();
  listeners.clear();
  editedBeforeLoad.clear();
  dirty.clear();
  deleted.clear();
  loaded = false;
  browser = false;
  current = "unavailable";
  error = null;
  initPromise = null;
  loadInFlight = null;
  pumping = null;
  backend = nativeBackend;
  timeoutMs = 3000;
  retryDelaysMs = [200, 800, 2000];
}
