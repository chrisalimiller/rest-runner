import type { Environment } from "./environments";
import type { RequestDef } from "./types";

/** File format for exporting and importing saved requests and environments. */
export interface WorkspaceFile {
  app: "rest-runner";
  version: 1;
  exportedAt: string;
  savedRequests: RequestDef[];
  environments: Environment[];
}

export function toWorkspaceFile(savedRequests: RequestDef[], environments: Environment[]): string {
  const file: WorkspaceFile = { app: "rest-runner", version: 1, exportedAt: new Date().toISOString(), savedRequests, environments };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  savedRequests: RequestDef[];
  environments: Environment[];
  added: number;
  replaced: number;
}

function isRequest(x: unknown): x is RequestDef {
  const r = x as RequestDef;
  return !!r && typeof r.id === "string" && typeof r.url === "string" && typeof r.method === "string" && Array.isArray(r.headers) && Array.isArray(r.params);
}

function isEnvironment(x: unknown): x is Environment {
  const e = x as Environment;
  return !!e && typeof e.id === "string" && typeof e.name === "string" && Array.isArray(e.vars);
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): { list: T[]; added: number; replaced: number } {
  const list = [...current];
  let added = 0;
  let replaced = 0;
  for (const item of incoming) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i === -1) {
      list.push(item);
      added += 1;
    } else {
      list[i] = item;
      replaced += 1;
    }
  }
  return { list, added, replaced };
}

/** Reads an exported file and merges it in. Items with the same id are replaced; others are added. */
export function importWorkspaceFile(text: string, savedRequests: RequestDef[], environments: Environment[]): ImportResult {
  let data: Partial<WorkspaceFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (data.app !== "rest-runner") throw new Error("This is not a REST Runner export file.");
  const reqs = (data.savedRequests ?? []).filter(isRequest);
  const envs = (data.environments ?? []).filter(isEnvironment);
  const r = mergeById(savedRequests, reqs);
  const e = mergeById(environments, envs);
  return { savedRequests: r.list, environments: e.list, added: r.added + e.added, replaced: r.replaced + e.replaced };
}
