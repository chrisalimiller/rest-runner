import { emptyRow } from "./defaults";
import { newEnvironment, type Environment } from "./environments";
import { newId } from "./ids";
import { requestPlaceholders } from "./request";
import type { Vars } from "./template";
import type { RequestDef } from "./types";

export type VariableSource = { kind: "env"; envName: string } | { kind: "script" } | { kind: "unset" };

export interface VariableRow {
  name: string;
  value: string;
  source: VariableSource;
  /** The value comes from an environment variable marked secret. */
  secret: boolean;
  /** The environment variable behind the value, so it can be opened for editing. */
  envVarId?: string;
}

/** Where a placeholder's value comes from. Script variables win over environment ones, as they do when sending. */
export function variableRow(name: string, env: Environment | null, scriptVars: Vars): VariableRow {
  if (Object.prototype.hasOwnProperty.call(scriptVars, name)) {
    return { name, value: scriptVars[name], source: { kind: "script" }, secret: false };
  }
  // The last enabled row wins, as environmentVars() does when sending.
  const v = env?.vars.filter((x) => x.enabled && x.key.trim() === name).pop();
  if (env && v) return { name, value: v.value, source: { kind: "env", envName: env.name }, secret: !!v.secret, envVarId: v.id };
  return { name, value: "", source: { kind: "unset" }, secret: false };
}

/** Every placeholder the request uses, with its value and where it comes from. */
export function requestVariableRows(def: RequestDef, env: Environment | null, scriptVars: Vars): VariableRow[] {
  return requestPlaceholders(def).map((name) => variableRow(name, env, scriptVars));
}

export function sourceLabel(source: VariableSource): string {
  if (source.kind === "env") return `Env · ${source.envName || "(unnamed)"}`;
  return source.kind === "script" ? "Script" : "Unset";
}

/** One place a variable is defined. */
export type VariableLayer =
  | { kind: "script"; value: string }
  | { kind: "env"; envId: string; envName: string; varId: string; value: string; secret: boolean; active: boolean };

export interface ResolvedVariable {
  name: string;
  /** Highest priority first; only the places that define the name. */
  layers: VariableLayer[];
  /** What a send uses now (script, else the active environment). Null when unset. */
  winner: VariableLayer | null;
  /** Defined but losing to the winner, such as the environment value under a script value. */
  shadowed: VariableLayer[];
}

/** The enabled row of an environment that sending uses for a name: the last one with that key. */
function envRow(env: Environment, name: string) {
  return env.vars.filter((v) => v.enabled && v.key.trim() === name).pop();
}

export function resolveVariable(name: string, envs: Environment[], activeEnvId: string | null, scriptVars: Vars): ResolvedVariable {
  const layers: VariableLayer[] = [];
  if (Object.prototype.hasOwnProperty.call(scriptVars, name)) layers.push({ kind: "script", value: scriptVars[name] });
  const ordered = [...envs.filter((e) => e.id === activeEnvId), ...envs.filter((e) => e.id !== activeEnvId)];
  for (const env of ordered) {
    const row = envRow(env, name);
    if (row) layers.push({ kind: "env", envId: env.id, envName: env.name, varId: row.id, value: row.value, secret: !!row.secret, active: env.id === activeEnvId });
  }
  const winner = layers.find((l) => l.kind === "script" || l.active) ?? null;
  const shadowed = winner ? layers.filter((l) => l !== winner && (l.kind === "script" || l.active)) : [];
  return { name, layers, winner, shadowed };
}

export interface SidebarEnvRow {
  varId: string;
  name: string;
  value: string;
  secret: boolean;
  /** The request uses this name. */
  used: boolean;
  /** Not what a send uses: a script variable wins, or a later row of the same environment repeats the key. */
  overriddenBy?: "script" | "later row";
}

export interface SidebarScriptRow {
  name: string;
  value: string;
  used: boolean;
  /** An active environment variable of the same name is hidden by this one. */
  hidesEnv: boolean;
}

export interface SidebarEnvGroup {
  env: Environment;
  rows: SidebarEnvRow[];
}

export interface SidebarGroups {
  /** Placeholders the request uses that nothing defines. Empty unless the list is filtered to the request. */
  missing: string[];
  script: SidebarScriptRow[];
  active: SidebarEnvGroup | null;
  others: SidebarEnvGroup[];
}

/** Groups variables by priority for the sidebar. With `used`, only the names the request uses are listed. */
export function variableIndex(envs: Environment[], activeEnvId: string | null, scriptVars: Vars, used: string[] | null): SidebarGroups {
  const usedSet = new Set(used ?? []);
  const keep = (name: string) => used === null || usedSet.has(name);
  const activeEnv = envs.find((e) => e.id === activeEnvId) ?? null;
  const activeNames = new Set(activeEnv ? activeEnv.vars.filter((v) => v.enabled && v.key.trim() !== "").map((v) => v.key.trim()) : []);

  const group = (env: Environment): SidebarEnvGroup => {
    const rows: SidebarEnvRow[] = [];
    env.vars.forEach((v, i) => {
      const name = v.key.trim();
      if (!v.enabled || name === "" || !keep(name)) return;
      const repeated = env.vars.slice(i + 1).some((w) => w.enabled && w.key.trim() === name);
      const overriddenBy = repeated ? "later row" : env.id === activeEnvId && Object.prototype.hasOwnProperty.call(scriptVars, name) ? "script" : undefined;
      rows.push({ varId: v.id, name, value: v.value, secret: !!v.secret, used: usedSet.has(name), overriddenBy });
    });
    return { env, rows };
  };

  const script = Object.keys(scriptVars)
    .filter(keep)
    .map((name) => ({ name, value: scriptVars[name], used: usedSet.has(name), hidesEnv: activeNames.has(name) }));
  const missing = used === null ? [] : used.filter((name) => !Object.prototype.hasOwnProperty.call(scriptVars, name) && !activeNames.has(name));
  const active = activeEnv ? group(activeEnv) : null;
  const others = envs.filter((e) => e.id !== activeEnvId).map(group).filter((g) => g.rows.length > 0);
  return { missing, script, active, others };
}

/** Sets the value of one variable row of an environment. */
export function setEnvVarValue(envs: Environment[], envId: string, varId: string, value: string): Environment[] {
  return envs.map((e) => (e.id === envId ? { ...e, vars: e.vars.map((v) => (v.id === varId ? { ...v, value } : v)) } : e));
}

/**
 * Adds a variable to an environment: blank rows are dropped and one is kept at the end for typing.
 * With no environments at all, creates "Environment 1" to hold it.
 */
export function addEnvVar(
  envs: Environment[],
  envId: string | null,
  name: string,
  value: string,
  secret: boolean,
): { envs: Environment[]; varId: string; envId: string } {
  const added = { id: newId(), key: name, value, enabled: true, ...(secret ? { secret: true } : {}) };
  const target = envs.find((e) => e.id === envId) ?? envs[0] ?? null;
  if (!target) {
    const env = { ...newEnvironment("Environment 1"), vars: [added, emptyRow()] };
    return { envs: [env], varId: added.id, envId: env.id };
  }
  const vars = target.vars.filter((v) => v.key !== "" || v.value !== "");
  return { envs: envs.map((e) => (e.id === target.id ? { ...e, vars: [...vars, added, emptyRow()] } : e)), varId: added.id, envId: target.id };
}
