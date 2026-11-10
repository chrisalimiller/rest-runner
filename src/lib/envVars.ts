import { emptyRow } from "./defaults";
import { newId } from "./ids";
import type { Environment } from "./environments";
import type { KeyValue } from "./types";

/** Name used for matching: trimmed, case-sensitive. Blank names never count. */
const nameOf = (v: KeyValue): string => v.key.trim();

export interface DuplicateGroup {
  name: string;
  /** 1-based row numbers, in order, so the last is the one that is used. */
  rows: number[];
}

export interface DuplicateReport {
  groups: DuplicateGroup[];
  /** Row id → 1-based number of the first row with the same name. Set only for the later copies. */
  firstRowOf: Map<string, number>;
}

/**
 * Variable names that appear more than once in one environment (case-sensitive, after trimming).
 * Only enabled rows count, because disabled rows are not used. Row numbers count every row, as shown on screen.
 */
export function findDuplicateNames(rows: readonly KeyValue[]): DuplicateReport {
  const seen = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const name = nameOf(r);
    if (!r.enabled || name === "") return;
    const list = seen.get(name);
    if (list) list.push(i + 1);
    else seen.set(name, [i + 1]);
  });
  const groups: DuplicateGroup[] = [];
  const firstRowOf = new Map<string, number>();
  for (const [name, list] of seen) {
    if (list.length < 2) continue;
    groups.push({ name, rows: list });
    for (const n of list.slice(1)) firstRowOf.set(rows[n - 1].id, list[0]);
  }
  return { groups, firstRowOf };
}

/** "1", "1 and 4", "1, 4 and 7". */
export function joinRowNumbers(rows: readonly number[]): string {
  if (rows.length <= 1) return rows.join("");
  return `${rows.slice(0, -1).join(", ")} and ${rows[rows.length - 1]}`;
}

export interface MatrixCell {
  envId: string;
  /** The row that holds this variable here, or null when the environment lacks it. */
  row: KeyValue | null;
}

export interface MatrixRow {
  name: string;
  cells: MatrixCell[];
  /** Secret in at least one environment that has it. */
  secret: boolean;
}

export interface Matrix {
  rows: MatrixRow[];
  /** Number of (variable, environment) pairs with no value. */
  missing: number;
}

/**
 * Variables (union of names across every environment, in first-seen order) by environment.
 * When a name repeats inside an environment the last row wins, as it does when sending.
 */
export function buildMatrix(envs: readonly Environment[]): Matrix {
  const names: string[] = [];
  const known = new Set<string>();
  const byEnv = envs.map((env) => {
    const m = new Map<string, KeyValue>();
    for (const v of env.vars) {
      const name = nameOf(v);
      if (name === "") continue;
      m.set(name, v);
      if (!known.has(name)) {
        known.add(name);
        names.push(name);
      }
    }
    return m;
  });
  let missing = 0;
  const rows = names.map((name) => {
    const cells = envs.map((env, i) => {
      const row = byEnv[i].get(name) ?? null;
      if (!row) missing += 1;
      return { envId: env.id, row };
    });
    return { name, cells, secret: cells.some((c) => c.row?.secret === true) };
  });
  return { rows, missing };
}

/**
 * Adds `name` with an empty value to one environment (before its trailing blank row).
 * It is secret there when it is secret anywhere else. Returns the environment unchanged when it already has it.
 */
export function addMissingVar(envs: readonly Environment[], envId: string, name: string): Environment[] {
  const secret = envs.some((e) => e.vars.some((v) => nameOf(v) === name && v.secret === true));
  return envs.map((env) => {
    if (env.id !== envId || env.vars.some((v) => nameOf(v) === name)) return env;
    const row: KeyValue = { id: newId(), key: name, value: "", enabled: true, ...(secret ? { secret: true } : {}) };
    const last = env.vars[env.vars.length - 1];
    const trailingBlank = last && last.key === "" && last.value === "";
    const vars = trailingBlank ? [...env.vars.slice(0, -1), row, last] : [...env.vars, row, emptyRow()];
    return { ...env, vars };
  });
}

/** Change one variable's value in one environment. */
export function setVarValue(envs: readonly Environment[], envId: string, rowId: string, value: string): Environment[] {
  return envs.map((env) => (env.id === envId ? { ...env, vars: env.vars.map((v) => (v.id === rowId ? { ...v, value } : v)) } : env));
}

/** Reveal state is a set of `envId:rowId` keys, so one environment's reveal never shows another's value. */
export const revealKey = (envId: string, rowId: string): string => `${envId}:${rowId}`;
