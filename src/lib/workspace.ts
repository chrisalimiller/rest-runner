import {
  cleanCollections,
  isRequestDef,
  locate,
  newCollection,
  requestNode,
  updateRequest,
  type Collection,
} from "./collections";
import type { Environment } from "./environments";
import { detectPostmanFile, importPostmanCollection, importPostmanEnvironment } from "./postman";
import type { RequestDef } from "./types";

/**
 * File format for exporting and importing collections and environments.
 * Version 1 files (a flat `savedRequests` list) still import.
 */
export interface WorkspaceFile {
  app: "rest-runner";
  version: 2;
  exportedAt: string;
  collections: Collection[];
  environments: Environment[];
}

export const IMPORTED_COLLECTION_NAME = "Imported requests";

export function toWorkspaceFile(collections: Collection[], environments: Environment[]): string {
  const file: WorkspaceFile = { app: "rest-runner", version: 2, exportedAt: new Date().toISOString(), collections, environments };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  collections: Collection[];
  environments: Environment[];
  added: number;
  replaced: number;
  /** Things in a Postman file that could not be carried over. */
  warnings?: string[];
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

/**
 * Reads an exported file, or a Postman collection (v2.0/v2.1) or environment
 * file, and merges it in. A collection or environment with the
 * same id replaces the current one; others are added. Requests from an old
 * version 1 file replace saved requests with the same id wherever they are, and
 * new ones go into an "Imported requests" collection.
 */
function importPostman(kind: "collection" | "environment", data: unknown, collections: Collection[], environments: Environment[]): ImportResult {
  if (kind === "environment") {
    const { environment, warnings } = importPostmanEnvironment(data);
    const e = mergeById(environments, [environment]);
    return { collections, environments: e.list, added: e.added, replaced: e.replaced, warnings };
  }
  const { collection, variables, warnings } = importPostmanCollection(data);
  const c = mergeById(collections, [collection]);
  const e = mergeById(environments, variables ? [variables] : []);
  return { collections: c.list, environments: e.list, added: c.added + e.added, replaced: c.replaced + e.replaced, warnings };
}

export function importWorkspaceFile(text: string, collections: Collection[], environments: Environment[]): ImportResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const postman = detectPostmanFile(data);
  if (postman) return importPostman(postman, data, collections, environments);
  if (!data || data.app !== "rest-runner") throw new Error("This is not a REST Runner export file.");

  const envs = (Array.isArray(data.environments) ? data.environments : []).filter(isEnvironment);
  const e = mergeById(environments, envs);

  let nextCollections: Collection[];
  let added = e.added;
  let replaced = e.replaced;

  if (Array.isArray(data.collections)) {
    const c = mergeById(collections, cleanCollections(data.collections));
    nextCollections = c.list;
    added += c.added;
    replaced += c.replaced;
  } else {
    // Version 1: a flat list of requests.
    const reqs = (Array.isArray(data.savedRequests) ? data.savedRequests : []).filter(isRequestDef);
    nextCollections = collections;
    const fresh: RequestDef[] = [];
    for (const r of reqs) {
      if (locate(nextCollections, r.id)?.kind === "request") {
        nextCollections = updateRequest(nextCollections, r);
        replaced += 1;
      } else {
        fresh.push(r);
      }
    }
    if (fresh.length > 0) {
      let target = nextCollections.find((c) => c.name === IMPORTED_COLLECTION_NAME);
      if (!target) {
        target = newCollection(IMPORTED_COLLECTION_NAME);
        nextCollections = [...nextCollections, target];
      }
      const id = target.id;
      nextCollections = nextCollections.map((c) => (c.id === id ? { ...c, items: [...c.items, ...fresh.map((r) => requestNode(r))] } : c));
      added += fresh.length;
    }
  }

  return { collections: nextCollections, environments: e.list, added, replaced };
}
