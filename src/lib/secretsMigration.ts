import { ENVIRONMENTS_KEY } from "./environments";
import { getSecret, setSecrets, status, whenFlushed } from "./secretStore";
import { isPlainObject, load, save } from "./storage";

export const SECRETS_MIGRATED_KEY = "rest-runner.secrets-migrated";

export interface MigrationResult {
  /** Secret values moved to the keychain (and removed from local storage) this run. */
  migrated: number;
  /** True when something blocked the move: plain values were left where they are, to be retried next launch. */
  failed: boolean;
}

let result: MigrationResult | null = null;
let running: Promise<MigrationResult> | null = null;
const listeners = new Set<() => void>();

/** The outcome of this launch's migration, or null before it has run. */
export function getMigrationResult(): MigrationResult | null {
  return result;
}

export function subscribeMigration(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function finish(r: MigrationResult): MigrationResult {
  result = r;
  for (const fn of [...listeners]) fn();
  return r;
}

type Target = { envId: string; varId: string; value: string };

const keyOf = (envId: unknown, varId: unknown, value: unknown) => `${String(envId)}\u0000${String(varId)}\u0000${String(value)}`;

function pending(): Target[] {
  const envs = load<unknown>(ENVIRONMENTS_KEY, []);
  const out: Target[] = [];
  if (!Array.isArray(envs)) return out;
  for (const e of envs as unknown[]) {
    if (!isPlainObject(e) || typeof e.id !== "string" || !Array.isArray(e.vars)) continue;
    for (const v of e.vars as unknown[]) {
      if (isPlainObject(v) && v.secret === true && typeof v.id === "string" && typeof v.value === "string" && v.value !== "") out.push({ envId: e.id, varId: v.id, value: v.value });
    }
  }
  return out;
}

/** Blanks exactly the confirmed values, re-reading storage so concurrent edits are kept. */
function scrub(done: Target[]): boolean {
  const envs = load<unknown>(ENVIRONMENTS_KEY, []);
  if (!Array.isArray(envs)) return true;
  const ok = new Set(done.map((t) => keyOf(t.envId, t.varId, t.value)));
  const next = (envs as unknown[]).map((e) => {
    if (!isPlainObject(e) || !Array.isArray(e.vars)) return e;
    return { ...e, vars: (e.vars as unknown[]).map((v) => (isPlainObject(v) && v.secret === true && ok.has(keyOf(e.id, v.id, v.value)) ? { ...v, value: "" } : v)) };
  });
  return save(ENVIRONMENTS_KEY, next);
}

async function migrate(): Promise<MigrationResult> {
  const s = status();
  if (s !== "ready" && s !== "browser-fallback") return finish({ migrated: 0, failed: pending().length > 0 });
  const todo = pending();
  if (todo.length === 0) {
    save(SECRETS_MIGRATED_KEY, true);
    return finish({ migrated: 0, failed: false });
  }
  // The keychain wins when it already holds a value for the variable.
  const toWrite = new Map<string, Record<string, string>>();
  for (const t of todo) {
    if (getSecret(t.envId, t.varId) !== "") continue;
    const m = toWrite.get(t.envId) ?? {};
    m[t.varId] = t.value;
    toWrite.set(t.envId, m);
  }
  for (const [envId, entries] of toWrite) setSecrets(envId, entries);
  await whenFlushed();
  const after = status();
  const confirmed = (after === "ready" || after === "browser-fallback") && todo.every((t) => getSecret(t.envId, t.varId) !== "");
  if (!confirmed) return finish({ migrated: 0, failed: true });
  if (!scrub(todo)) return finish({ migrated: 0, failed: true });
  save(SECRETS_MIGRATED_KEY, true);
  return finish({ migrated: todo.length, failed: false });
}

/** Moves plain-text secret values from local storage into the keychain. Call after `initSecretStore`. Safe to repeat. */
export function runSecretsMigration(): Promise<MigrationResult> {
  running ??= migrate()
    .catch(() => finish({ migrated: 0, failed: true }))
    .finally(() => {
      running = null;
    });
  return running;
}

/** For tests. */
export function resetMigrationForTests(): void {
  result = null;
  running = null;
  listeners.clear();
}
