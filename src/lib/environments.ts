import { emptyRow } from "./defaults";
import { newId } from "./ids";
import type { Vars } from "./template";
import { deleteEnv, getEnvSecrets, hydrationEpoch, isBrowserFallback, isHydrated, isPersisted, removeSecrets, setSecrets, subscribe, whenFlushed } from "./secretStore";
import { load, save } from "./storage";
import type { KeyValue } from "./types";

/** A named set of variables, such as base URLs and tokens for Dev or Prod. */
export interface Environment {
  id: string;
  name: string;
  vars: KeyValue[];
  /** Shown as a dot on the switch and as an outline on Send, Run suite and Run. Missing on older data: see `cleanEnvironments`. */
  color?: EnvColor;
}

export function newEnvironment(name: string): Environment {
  return { id: newId(), name, vars: [emptyRow()], color: defaultEnvColor(name) };
}

/** The enabled variables of an environment as name → value. */
export function environmentVars(env: Environment | null | undefined): Vars {
  const out: Vars = {};
  if (!env) return out;
  for (const v of env.vars) if (v.enabled && v.key.trim() !== "") out[v.key.trim()] = v.value;
  return out;
}

export type EnvColor = "none" | "green" | "blue" | "amber" | "red";
export const ENV_COLORS: EnvColor[] = ["none", "green", "blue", "amber", "red"];

/** Existing tokens, so a coloured environment matches the rest of the app. */
export const ENV_COLOR_VARS: Record<Exclude<EnvColor, "none">, string> = {
  green: "var(--ok)",
  blue: "var(--redirect)",
  amber: "var(--warn)",
  red: "var(--danger)",
};

/** Prod, Production and PRD (any case) are red unless told otherwise. */
export function defaultEnvColor(name: string): EnvColor {
  return /^(prod|production|prd)$/i.test(name.trim()) ? "red" : "none";
}

function isColor(x: unknown): x is EnvColor {
  return typeof x === "string" && (ENV_COLORS as string[]).includes(x);
}

/** An environment's colour, or "none". */
export function envColor(env: Environment | null | undefined): EnvColor {
  return env?.color ?? "none";
}

/**
 * What the buttons that act on an environment say, so a run against Prod never reads like any other:
 * "Send to Prod", "Run suite on Prod", "Run on Prod". Null when the environment has no colour.
 */
export function guardFor(env: Environment | null | undefined): { color: Exclude<EnvColor, "none">; cssColor: string; name: string; send: string; runSuite: string; run: string } | null {
  const color = envColor(env);
  if (!env || color === "none") return null;
  const name = env.name.trim() || "(unnamed)";
  return { color, cssColor: ENV_COLOR_VARS[color], name, send: `Send to ${name}`, runSuite: `Run suite on ${name}`, run: `Run on ${name}` };
}

/** Gives every variable a unique, non-empty id (secrets are keyed by it). Deterministic and idempotent. */
function normaliseVarIds(envId: string, vars: KeyValue[]): KeyValue[] {
  const seen = new Set<string>();
  let changed = false;
  const out = vars.map((v, i) => {
    if (typeof v?.id === "string" && v.id !== "" && !seen.has(v.id)) {
      seen.add(v.id);
      return v;
    }
    let id = `${envId}-v${i}`;
    for (let n = 1; seen.has(id) || vars.some((x, j) => j !== i && x?.id === id); n++) id = `${envId}-v${i}-${n}`;
    seen.add(id);
    changed = true;
    return { ...v, id };
  });
  return changed ? out : vars;
}

/** Reads stored environments, dropping broken ones. Data saved before colours existed gets the default for its name. */
export function cleanEnvironments(input: unknown): Environment[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as Environment).id === "string" && Array.isArray((e as Environment).vars))
    .map((e) => {
      const name = typeof e.name === "string" ? e.name : "";
      const env = e as unknown as Environment;
      return { ...env, name, vars: normaliseVarIds(env.id, env.vars), color: isColor(e.color) ? e.color : defaultEnvColor(name) };
    });
}

export const ENVIRONMENTS_KEY = "rest-runner.environments";

/** Environments exactly as stored: secret values are blank once they live in the keychain. */
function rawEnvironments(): Environment[] {
  return cleanEnvironments(load<unknown>(ENVIRONMENTS_KEY, []));
}

/** The keychain epoch the most recently loaded environments were filled in at. */
let stateEpoch = 0;

/**
 * Reads the environments and fills in secret values from the secret store (keyed by environment and variable id).
 * A value still sitting in local storage (not yet migrated to the keychain) is used when the store has none.
 * In the dev browser the store is not used: values stay in local storage.
 */
export function loadEnvironments(): Environment[] {
  const raw = rawEnvironments();
  if (isBrowserFallback()) return raw;
  stateEpoch = hydrationEpoch();
  return raw.map((env) => {
    const stored = getEnvSecrets(env.id);
    return { ...env, vars: env.vars.map((v) => (v.secret ? { ...v, value: Object.hasOwn(stored, v.id) ? stored[v.id] : v.value } : v)) };
  });
}

/**
 * Folds freshly loaded environments (after the keychain was read) into the state the user may already be editing.
 * The current structure and every non-empty secret value win; only blank secrets take the loaded value.
 */
export function mergeHydrated(current: readonly Environment[], fresh: readonly Environment[]): Environment[] {
  const byId = new Map(fresh.map((e) => [e.id, e]));
  let changed = false;
  const out = current.map((env) => {
    const f = byId.get(env.id);
    if (!f) return env;
    const fv = new Map(f.vars.map((v) => [v.id, v]));
    const vars = env.vars.map((v) => {
      const x = fv.get(v.id);
      if (!v.secret || v.value !== "" || !x || !x.secret || x.value === "") return v;
      changed = true;
      return { ...v, value: x.value };
    });
    return vars.some((v, i) => v !== env.vars[i]) ? { ...env, vars } : env;
  });
  return changed ? out : (current as Environment[]);
}

/**
 * Calls `reload` whenever the keychain has been read since these environments were loaded (also right away if that
 * already happened). Returns the unsubscribe function. `reload` should set `mergeHydrated(state, loadEnvironments())`.
 */
export function onSecretsHydrated(reload: () => void): () => void {
  if (isBrowserFallback()) return () => {};
  let seen = hydrationEpoch();
  if (seen !== stateEpoch) reload();
  return subscribe(() => {
    const e = hydrationEpoch();
    if (e === seen) return;
    seen = e;
    reload();
  });
}

/** A copy with every secret value emptied (the flag stays). Never mutates its input. */
export function blankSecrets(envs: readonly Environment[]): Environment[] {
  return envs.map((env) => ({ ...env, vars: env.vars.map((v) => (v.secret ? { ...v, value: "" } : v)) }));
}

/** Plain copies left on disk because the keychain has not confirmed the value yet: "env\0var" -> value awaited. */
const awaiting = new Map<string, string>();
let unsubAwaiting: (() => void) | null = null;

/** Blanks plain copies on disk once the keychain confirms the value that replaced them. */
function reconcileDisk() {
  if (awaiting.size === 0) return;
  const raw = rawEnvironments();
  let changed = false;
  const next = raw.map((env) => ({
    ...env,
    vars: env.vars.map((v) => {
      const key = `${env.id}\0${v.id}`;
      const want = awaiting.get(key);
      if (want === undefined) return v;
      if (v.secret && v.value !== "" && isPersisted(env.id, v.id, want)) {
        awaiting.delete(key);
        changed = true;
        return { ...v, value: "" };
      }
      return v;
    }),
  }));
  if (changed) save(ENVIRONMENTS_KEY, next);
  if (awaiting.size === 0) {
    unsubAwaiting?.();
    unsubAwaiting = null;
  }
}

function settleAwaiting() {
  unsubAwaiting?.();
  unsubAwaiting = null;
  if (awaiting.size > 0) {
    unsubAwaiting = subscribe(reconcileDisk);
    void whenFlushed().then(reconcileDisk);
  }
}

/**
 * The only way to write environments. Secret values go to the secret store (keychain); local storage gets a copy
 * with them blanked, but only once the keychain has confirmed that exact value. Until then a plain copy already on
 * disk is kept (it is the only durable one) and no new plain value is ever written. Returns false when local
 * storage refused the write. In the dev browser values stay in local storage as before.
 *
 * Secrets are only removed from the store when these environments were loaded after the keychain was read; a blank
 * value from an unhydrated state never deletes anything. Variables and environments that vanished from the list do.
 */
export function saveEnvironments(envs: readonly Environment[]): boolean {
  const previous = rawEnvironments();
  const browser = isBrowserFallback();
  const hydrated = !browser && isHydrated() && stateEpoch === hydrationEpoch();
  const ids = new Set(envs.map((e) => e.id));
  for (const old of previous) if (!ids.has(old.id)) deleteEnv(old.id);
  for (const env of envs) {
    const keep: Record<string, string> = {};
    const drop: string[] = [];
    const prevEnv = previous.find((p) => p.id === env.id);
    const present = new Set(env.vars.map((v) => v.id));
    for (const v of env.vars) {
      if (v.secret && v.value !== "") keep[v.id] = v.value;
      else if (hydrated || browser) drop.push(v.id);
    }
    // A variable that is gone entirely (or no longer secret) is cleared even if we never read the keychain.
    for (const o of prevEnv?.vars ?? []) {
      if (!present.has(o.id) || (o.secret && !env.vars.find((v) => v.id === o.id)?.secret)) if (!drop.includes(o.id)) drop.push(o.id);
    }
    const held = getEnvSecrets(env.id);
    if (hydrated || browser) for (const k of Object.keys(held)) if (!(k in keep) && !drop.includes(k)) drop.push(k); // var deleted outright
    const stale = browser || !isHydrated() ? drop : drop.filter((k) => k in held);
    if (stale.length) removeSecrets(env.id, stale);
    if (Object.keys(keep).length) setSecrets(env.id, keep);
  }
  if (browser) return save(ENVIRONMENTS_KEY, envs as Environment[]);
  awaiting.clear();
  const out = blankSecrets(envs);
  for (const env of out) {
    const old = previous.find((p) => p.id === env.id);
    const src = envs.find((e) => e.id === env.id);
    if (!old || !src) continue;
    env.vars = env.vars.map((v) => {
      if (!v.secret) return v;
      const cur = src.vars.find((x) => x.id === v.id)?.value ?? "";
      const o = old.vars.find((x) => x.id === v.id);
      if (!o?.secret || o.value === "") return v; // nothing on disk to protect
      if (cur !== "" && isPersisted(env.id, v.id, cur)) return v; // confirmed: blank
      if (cur === "" && hydrated) return v; // cleared on purpose
      if (cur !== "") awaiting.set(`${env.id}\0${v.id}`, cur);
      return { ...v, value: o.value };
    });
  }
  settleAwaiting();
  return save(ENVIRONMENTS_KEY, out);
}
