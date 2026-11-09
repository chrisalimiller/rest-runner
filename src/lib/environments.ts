import { emptyRow } from "./defaults";
import { newId } from "./ids";
import type { Vars } from "./template";
import { deleteEnv, getEnvSecrets, removeSecrets, setSecrets, status as secretStatus } from "./secretStore";
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

/** Reads stored environments, dropping broken ones. Data saved before colours existed gets the default for its name. */
export function cleanEnvironments(input: unknown): Environment[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as Environment).id === "string" && Array.isArray((e as Environment).vars))
    .map((e) => {
      const name = typeof e.name === "string" ? e.name : "";
      return { ...(e as unknown as Environment), name, color: isColor(e.color) ? e.color : defaultEnvColor(name) };
    });
}

export const ENVIRONMENTS_KEY = "rest-runner.environments";

/** Environments exactly as stored: secret values are blank once they live in the keychain. */
function rawEnvironments(): Environment[] {
  return cleanEnvironments(load<unknown>(ENVIRONMENTS_KEY, []));
}

/**
 * Reads the environments and fills in secret values from the secret store (keyed by environment and variable id).
 * A value still sitting in local storage (not yet migrated to the keychain) is used when the store has none.
 */
export function loadEnvironments(): Environment[] {
  return rawEnvironments().map((env) => {
    const stored = getEnvSecrets(env.id);
    return { ...env, vars: env.vars.map((v) => (v.secret ? { ...v, value: Object.hasOwn(stored, v.id) ? stored[v.id] : v.value } : v)) };
  });
}

/** A copy with every secret value emptied (the flag stays). Never mutates its input. */
export function blankSecrets(envs: readonly Environment[]): Environment[] {
  return envs.map((env) => ({ ...env, vars: env.vars.map((v) => (v.secret ? { ...v, value: "" } : v)) }));
}

/**
 * The only way to write environments. Secret values go to the secret store (keychain, or this session only when it
 * is unavailable); local storage gets a copy with them blanked. Returns false when local storage refused the write.
 */
export function saveEnvironments(envs: readonly Environment[]): boolean {
  const previous = rawEnvironments();
  const persistent = (() => {
    const s = secretStatus();
    return s === "ready" || s === "browser-fallback";
  })();
  const ids = new Set(envs.map((e) => e.id));
  for (const old of previous) if (!ids.has(old.id)) deleteEnv(old.id);
  for (const env of envs) {
    const keep: Record<string, string> = {};
    const drop: string[] = [];
    for (const v of env.vars) {
      if (v.secret && v.value !== "") keep[v.id] = v.value;
      else drop.push(v.id);
    }
    const held = getEnvSecrets(env.id);
    for (const k of Object.keys(held)) if (!(k in keep) && !drop.includes(k)) drop.push(k); // var deleted outright
    const stale = drop.filter((k) => k in held);
    if (stale.length) removeSecrets(env.id, stale);
    if (Object.keys(keep).length) setSecrets(env.id, keep);
  }
  const out = blankSecrets(envs);
  if (!persistent) {
    // Keychain not usable: a plain value already on disk (not yet migrated) is left as it is rather than lost.
    for (const env of out) {
      const old = previous.find((p) => p.id === env.id);
      const src = envs.find((e) => e.id === env.id);
      if (!old || !src) continue;
      env.vars = env.vars.map((v) => {
        const o = old.vars.find((x) => x.id === v.id);
        const cur = src.vars.find((x) => x.id === v.id);
        return v.secret && o?.secret && o.value !== "" && cur?.value === o.value ? { ...v, value: o.value } : v;
      });
    }
  }
  return save(ENVIRONMENTS_KEY, out);
}
