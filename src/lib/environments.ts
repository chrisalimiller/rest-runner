import { emptyRow } from "./defaults";
import { newId } from "./ids";
import type { Vars } from "./template";
import { load } from "./storage";
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

export function loadEnvironments(): Environment[] {
  return cleanEnvironments(load<unknown>(ENVIRONMENTS_KEY, []));
}
