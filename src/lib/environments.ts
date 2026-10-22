import { emptyRow } from "./defaults";
import { newId } from "./ids";
import type { Vars } from "./template";
import type { KeyValue } from "./types";

/** A named set of variables, such as base URLs and tokens for Dev or Prod. */
export interface Environment {
  id: string;
  name: string;
  vars: KeyValue[];
}

export function newEnvironment(name: string): Environment {
  return { id: newId(), name, vars: [emptyRow()] };
}

/** The enabled variables of an environment as name → value. */
export function environmentVars(env: Environment | null | undefined): Vars {
  const out: Vars = {};
  if (!env) return out;
  for (const v of env.vars) if (v.enabled && v.key.trim() !== "") out[v.key.trim()] = v.value;
  return out;
}
