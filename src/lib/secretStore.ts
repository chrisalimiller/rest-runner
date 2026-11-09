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
/** Gaps between background re-attempts while writes are failing (status `unsaved`); the last one repeats. */
let repumpDelaysMs = [5000, 15000, 60000];

const cache = new Map<string, Map<string, string>>();
const listeners = new Set<() => void>();
/** Envs edited before the first load succeeded: merged over what the keychain holds. */
const editedBeforeLoad = new Set<string>();
const dirty = new Set<string>();
const deleted = new Set<string>();
/** Deletes and clears made before the first successful load: applied right after it (never written before). */
const pendingDeletes = new Set<string>();
const pendingClears = new Map<string, Set<string>>();
/** What the keychain is known to hold (read at load, or written successfully): envId -> varId -> value. */
const persisted = new Map<string, Map<string, string>>();
/** Counts successful keychain loads; environments hydrated at an older epoch must not delete secrets. */
let epoch = 0;
let repumpTimer: ReturnType<typeof setTimeout> | null = null;
let repumpCount = 0;

let loaded = false;
/** True once the first load attempt has finished, whatever its outcome. */
let attempted = false;
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

/** Throws on a damaged item so the load fails visibly instead of the next save overwriting it. */
function parseEnv(json: string | null): Record<string, string> {
  if (!json) return {};
  const o = JSON.parse(json) as unknown;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("A stored secrets item is damaged.");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
  return out;
}

/** Ids of the environments saved in local storage (read directly: environments.ts imports this module). */
function knownEnvIds(): string[] {
  try {
    const raw = localStorage.getItem("rest-runner.environments");
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.flatMap((e) => (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string" ? [(e as { id: string }).id] : []));
  } catch {
    return [];
  }
}

async function load(): Promise<void> {
  try {
    await backend.available();
    // The keychain index can be damaged or miss an environment, and the keychain cannot be enumerated. So also
    // try the environments the app already knows about: an index failure must not stop secrets from loading.
    const known = knownEnvIds();
    let indexed: string[] = [];
    try {
      indexed = await backend.listEnvs();
    } catch (e) {
      // With no known environment to read there is nothing to prove the keychain works, so treat this as a
      // failed load (never as an empty one: an empty load would let later writes replace stored secrets).
      if (known.length === 0) throw e;
    }
    const ids = [...new Set([...indexed, ...known])];
    const stored = new Map<string, Record<string, string>>();
    for (const id of ids) stored.set(id, parseEnv(await backend.readEnv(id)));
    // Hydrate: stored values fill in, values edited this session win.
    for (const [id, vars] of stored) {
      const m = envMap(id);
      const local = editedBeforeLoad.has(id) || dirty.has(id);
      for (const [k, v] of Object.entries(vars)) if (!local || !m.has(k)) m.set(k, v);
      persisted.set(id, new Map(Object.entries(vars)));
    }
    loaded = true;
    epoch++;
    // Edits made while the keychain was unread: apply them now that stored values are known.
    for (const id of pendingDeletes) {
      cache.delete(id);
      dirty.delete(id);
      editedBeforeLoad.delete(id);
      if (stored.has(id)) deleted.add(id);
    }
    pendingDeletes.clear();
    for (const [id, keys] of pendingClears) {
      const m = cache.get(id);
      if (!m) continue;
      let changed = false;
      for (const k of keys) changed = m.delete(k) || changed;
      if (changed) editedBeforeLoad.add(id);
    }
    pendingClears.clear();
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
      attempted = true;
      setStatus("browser-fallback", null);
      notify();
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
    attempted = true;
    notify();
    return current;
  })();
  return initPromise;
}

/** Runs the load again (e.g. after the user unlocked the keychain). */
export function retry(): Promise<StoreStatus> {
  if (loaded && !browser) {
    // Already read: never read again over unsaved edits, just try to write them.
    repumpCount = 0;
    pump();
    return Promise.resolve(current);
  }
  initPromise = null;
  return initSecretStore();
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

function scheduleRepump() {
  if (repumpTimer !== null || !(dirty.size || deleted.size)) return;
  const delay = repumpDelaysMs[Math.min(repumpCount, repumpDelaysMs.length - 1)] ?? 60000;
  repumpCount++;
  repumpTimer = setTimeout(() => {
    repumpTimer = null;
    pump();
  }, delay);
}

/** One serialized loop over all pending envs; the cache is read at write time, so edits coalesce. */
function pump() {
  if (pumping || browser || !loaded) return;
  if (!dirty.size && !deleted.size) return;
  let p: Promise<void> | undefined;
  p = (async () => {
    // Defer the body so `pumping` is assigned before anything can finish it.
    await Promise.resolve();
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
        if (ok) persisted.delete(id);
        else deleted.add(id);
      } else {
        dirty.delete(id);
        const entries = [...(cache.get(id) ?? [])];
        const json = JSON.stringify(Object.fromEntries(entries));
        ok = await writeWithRetry(() => backend.writeEnv(id, json));
        if (ok) persisted.set(id, new Map(entries));
        else dirty.add(id);
      }
      if (!ok) {
        failed = true;
        skip.add(id);
      }
    }
    if (pumping === p) pumping = null;
    if (failed) {
      setStatus("unsaved", error);
      scheduleRepump();
    } else {
      repumpCount = 0;
      if (current === "unsaved") setStatus("ready", null);
    }
    notify(); // lets callers learn what is now confirmed in the keychain
  })();
  pumping = p;
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
  pendingDeletes.delete(envId);
  for (const k of Object.keys(entries)) pendingClears.get(envId)?.delete(k);
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
  if (!loaded && !browser && varIds) {
    // Not read yet: the keychain may hold these, so remember the clear and apply it after the load.
    let set = pendingClears.get(envId);
    if (!set) pendingClears.set(envId, (set = new Set()));
    for (const k of varIds) set.add(k);
  }
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
  } else {
    pendingDeletes.add(envId);
    pendingClears.delete(envId);
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

/**
 * True once the first load attempt has finished (ready, or failed as unavailable/denied). Secret inputs wait
 * for this so nobody edits before hydration; after a failed attempt they work in session-only mode.
 */
export function isLoaded(): boolean {
  return attempted;
}

/** True once the keychain was read successfully (or in the dev browser, where there is nothing to read). */
export function isHydrated(): boolean {
  return loaded;
}

/** Number of successful keychain loads so far. */
export function hydrationEpoch(): number {
  return epoch;
}

/** True in the dev browser, where secrets are not kept in the keychain at all. */
export function isBrowserFallback(): boolean {
  return !isTauri();
}

/** True when the keychain is known to hold exactly this value for the variable. */
export function isPersisted(envId: string, varId: string, value: string): boolean {
  return !browser && value !== "" && persisted.get(envId)?.get(varId) === value;
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

export function configureSecretStore(opts: { timeoutMs?: number; retryDelaysMs?: number[]; repumpDelaysMs?: number[] }): void {
  if (opts.repumpDelaysMs) repumpDelaysMs = opts.repumpDelaysMs;
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
  pendingDeletes.clear();
  pendingClears.clear();
  persisted.clear();
  epoch = 0;
  if (repumpTimer !== null) clearTimeout(repumpTimer);
  repumpTimer = null;
  repumpCount = 0;
  repumpDelaysMs = [5000, 15000, 60000];
  loaded = false;
  attempted = false;
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
