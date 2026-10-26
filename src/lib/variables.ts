import type { Environment } from "./environments";
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
  const v = env?.vars.find((x) => x.enabled && x.key.trim() === name);
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
