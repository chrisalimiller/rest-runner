import {
  cleanCollections,
  isRequestDef,
  locate,
  newCollection,
  requestNode,
  updateRequest,
  type Collection,
} from "./collections";
import { cleanEnvironments, type Environment } from "./environments";
import { importFlowsFile } from "./flows/flowFile";
import { cleanFlows } from "./flows/flows";
import type { Flow } from "./flows/types";
import { importSuitesFile } from "./testing/suiteFile";
import { cleanSuites } from "./testing/suites";
import type { TestSuite } from "./testing/types";
import type { RequestDef } from "./types";

/**
 * File format for exporting and importing a whole workspace: collections,
 * environments, test suites and flows. Version 2 files (no suites or flows) and
 * version 1 files (a flat `savedRequests` list) still import, and so do the
 * separate suites and flows files.
 */
export interface WorkspaceFile {
  app: "rest-runner";
  kind: "workspace";
  version: 3;
  exportedAt: string;
  collections: Collection[];
  environments: Environment[];
  suites: TestSuite[];
  flows: Flow[];
}

/** Everything a workspace file holds. */
export interface Workspace {
  collections: Collection[];
  environments: Environment[];
  suites: TestSuite[];
  flows: Flow[];
}

export const IMPORTED_COLLECTION_NAME = "Imported requests";

/** The environments as they are written to a file: secret values are emptied (the flag stays) unless asked for. */
export function exportEnvironments(environments: Environment[], includeSecrets: boolean): Environment[] {
  if (includeSecrets) return environments;
  return environments.map((env) => ({ ...env, vars: env.vars.map((v) => (v.secret ? { ...v, value: "" } : v)) }));
}

export function toWorkspaceFile(
  collections: Collection[],
  environments: Environment[],
  options: { includeSecrets?: boolean; suites?: TestSuite[]; flows?: Flow[] } = {},
): string {
  environments = exportEnvironments(environments, options.includeSecrets ?? false);
  const file: WorkspaceFile = {
    app: "rest-runner",
    kind: "workspace",
    version: 3,
    exportedAt: new Date().toISOString(),
    collections,
    environments,
    suites: options.suites ?? [],
    flows: options.flows ?? [],
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  collections: Collection[];
  environments: Environment[];
  added: number;
  replaced: number;
}

export interface WorkspaceImport extends Workspace {
  /** What changed, as [added, updated] pairs. */
  counts: { collections: [number, number]; environments: [number, number]; suites: [number, number]; flows: [number, number]; requests: [number, number] };
}

function isEnvironment(x: unknown): x is Environment {
  const e = x as Environment;
  return !!e && typeof e.id === "string" && typeof e.name === "string" && Array.isArray(e.vars);
}

/** An imported secret with no value (the file was exported without secrets) keeps the value already on this computer. */
function keepSecretValues(incoming: Environment, current: Environment | undefined): Environment {
  if (!current) return incoming;
  return {
    ...incoming,
    vars: incoming.vars.map((v) => {
      if (!v.secret || v.value !== "") return v;
      const mine = current.vars.find((c) => c.id === v.id) ?? current.vars.find((c) => c.key === v.key && c.key !== "");
      return mine?.secret ? { ...v, value: mine.value } : v;
    }),
  };
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
 * Reads an exported file and merges it in. A collection or environment with the
 * same id replaces the current one; others are added. Requests from an old
 * version 1 file replace saved requests with the same id wherever they are, and
 * new ones go into an "Imported requests" collection.
 */
export function importWorkspaceFile(text: string, collections: Collection[], environments: Environment[]): ImportResult {
  return importCollectionsAndEnvironments(parseExport(text), collections, environments);
}

function parseExport(text: string): Record<string, unknown> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!data || data.app !== "rest-runner") throw new Error("This is not a REST Runner export file.");
  return data;
}

/**
 * Reads any REST Runner export (a workspace file of any version, a test suites
 * file or a flows file) and merges everything in it into the current workspace.
 */
export function importWorkspace(text: string, current: Workspace): WorkspaceImport {
  const data = parseExport(text);
  const zero: [number, number] = [0, 0];
  const counts: WorkspaceImport["counts"] = { collections: zero, environments: zero, suites: zero, flows: zero, requests: zero };
  if (data.kind === "flows") {
    const r = importFlowsFile(text, current);
    return { ...current, flows: r.flows, suites: r.suites, collections: r.collections, counts: { ...counts, flows: r.counts.flows, suites: r.counts.suites, requests: r.counts.requests } };
  }
  if (data.kind === "test-suites") {
    const r = importSuitesFile(text, current.suites);
    return { ...current, suites: r.suites, counts: { ...counts, suites: [r.added, r.replaced] } };
  }
  const base = importCollectionsAndEnvironments(data, current.collections, current.environments);
  const suites = mergeById(current.suites, cleanSuites(data.suites));
  const flows = mergeById(current.flows, cleanFlows(data.flows));
  const incomingEnvs = (Array.isArray(data.environments) ? data.environments : []).filter(isEnvironment);
  const envReplaced = incomingEnvs.filter((e) => current.environments.some((x) => x.id === e.id)).length;
  const envCount: [number, number] = [incomingEnvs.length - envReplaced, envReplaced];
  return {
    collections: base.collections,
    environments: base.environments,
    suites: suites.list,
    flows: flows.list,
    counts: {
      ...counts,
      collections: [base.added - envCount[0], base.replaced - envCount[1]],
      environments: envCount,
      suites: [suites.added, suites.replaced],
      flows: [flows.added, flows.replaced],
    },
  };
}

function importCollectionsAndEnvironments(data: Record<string, unknown>, collections: Collection[], environments: Environment[]): ImportResult {

  const envs = cleanEnvironments((Array.isArray(data.environments) ? data.environments : []).filter(isEnvironment));
  const e = mergeById(
    environments,
    envs.map((env) => keepSecretValues(env, environments.find((x) => x.id === env.id))),
  );

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

/** One line for the notice after an import: "Imported x.json: collections: 1 added; flows: 1 added." */
export function describeWorkspaceImport(name: string, c: WorkspaceImport["counts"]): string {
  const part = (label: string, [a, r]: [number, number]) => (a || r ? `${label}: ${[a ? `${a} added` : "", r ? `${r} updated` : ""].filter(Boolean).join(", ")}` : null);
  const parts = [
    part("collections", c.collections),
    part("saved requests", c.requests),
    part("environments", c.environments),
    part("suites", c.suites),
    part("flows", c.flows),
  ].filter(Boolean);
  return `Imported ${name}: ${parts.join("; ") || "nothing new"}.`;
}
