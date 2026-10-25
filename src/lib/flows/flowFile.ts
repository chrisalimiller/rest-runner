import { cleanCollections, locate, newCollection, newFolder, type Collection, type FolderNode, type RequestNode, type TreeNode } from "../collections";
import { cleanSuites } from "../testing/suites";
import type { TestSuite } from "../testing/types";
import { cleanFlows } from "./flows";
import type { Flow } from "./types";

/** A saved request a flow uses, with where it sat so the import can put it back in the same place. */
export interface ExportedRequest {
  collectionName: string;
  folderPath: string[];
  node: RequestNode;
}

/** File format for exporting flows together with the suites and saved requests they run. */
export interface FlowsFile {
  app: "rest-runner";
  kind: "flows";
  version: 1;
  exportedAt: string;
  flows: Flow[];
  suites: TestSuite[];
  requests: ExportedRequest[];
}

/** The suites and saved requests the given flows run. Run request steps can point at an example; its whole request comes along. */
export function itemsUsedBy(flows: Flow[], suites: TestSuite[], collections: Collection[]): { suites: TestSuite[]; requests: ExportedRequest[] } {
  const suiteIds = new Set<string>();
  const requestIds = new Set<string>();
  for (const f of flows) {
    for (const n of f.nodes) {
      if (n.type === "run-case" || n.type === "run-suite") suiteIds.add(n.suiteId);
      if (n.type === "run-request") requestIds.add(n.requestId);
    }
  }
  const requests = new Map<string, ExportedRequest>();
  for (const id of requestIds) {
    const found = locate(collections, id);
    if (!found || (found.kind !== "request" && found.kind !== "example")) continue;
    requests.set(found.node.id, { collectionName: found.collection.name, folderPath: found.path.map((p) => p.name), node: found.node });
  }
  return { suites: suites.filter((s) => suiteIds.has(s.id)), requests: [...requests.values()] };
}

export function toFlowsFile(flows: Flow[], suites: TestSuite[], collections: Collection[]): string {
  const used = itemsUsedBy(flows, suites, collections);
  const file: FlowsFile = { app: "rest-runner", kind: "flows", version: 1, exportedAt: new Date().toISOString(), flows, ...used };
  return JSON.stringify(file, null, 2);
}

/** Replaces a node with the same id anywhere in the tree. Returns null when the id is not there. */
function replaceNode(collections: Collection[], node: RequestNode): Collection[] | null {
  let found = false;
  const walk = (items: TreeNode[]): TreeNode[] =>
    items.map((i) => {
      if (i.kind === "folder") return { ...i, items: walk(i.items) };
      if (i.id === node.id) {
        found = true;
        return node;
      }
      return i;
    });
  const next = collections.map((c) => ({ ...c, items: walk(c.items) }));
  return found ? next : null;
}

/** Adds a node under a collection and folder path found (or made) by name. */
function addByPath(collections: Collection[], collectionName: string, folderPath: string[], node: RequestNode): Collection[] {
  const list = [...collections];
  let ci = list.findIndex((c) => c.name === collectionName);
  if (ci === -1) {
    list.push(newCollection(collectionName));
    ci = list.length - 1;
  }
  const add = (items: TreeNode[], path: string[]): TreeNode[] => {
    if (path.length === 0) return [...items, node];
    const [head, ...rest] = path;
    const i = items.findIndex((x) => x.kind === "folder" && x.name === head);
    if (i === -1) return [...items, { ...newFolder(head), items: add([], rest) }];
    const folder = items[i] as FolderNode;
    return items.map((x, j) => (j === i ? { ...folder, items: add(folder.items, rest) } : x));
  };
  list[ci] = { ...list[ci], items: add(list[ci].items, folderPath) };
  return list;
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

export interface FlowsImport {
  flows: Flow[];
  suites: TestSuite[];
  collections: Collection[];
  counts: { flows: [added: number, replaced: number]; suites: [number, number]; requests: [number, number] };
}

/**
 * Merges an exported flows file. Anything with the same id (flow, suite, saved request)
 * is replaced; everything else is added. New saved requests go back into a collection and
 * folders with the same names they had, made if missing.
 */
export function importFlowsFile(text: string, current: { flows: Flow[]; suites: TestSuite[]; collections: Collection[] }): FlowsImport {
  let data: Partial<FlowsFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (data.app !== "rest-runner" || data.kind !== "flows") throw new Error("This is not a REST Runner flows file.");
  const flows = mergeById(current.flows, cleanFlows(data.flows));
  const suites = mergeById(current.suites, cleanSuites(data.suites));

  let collections = current.collections;
  let addedRequests = 0;
  let replacedRequests = 0;
  for (const r of Array.isArray(data.requests) ? data.requests : []) {
    if (!r || typeof r !== "object") continue;
    const [node] = cleanCollections([{ id: "import", name: "import", items: [r.node] }])[0].items;
    if (!node || node.kind !== "request") continue;
    const replaced = replaceNode(collections, node);
    if (replaced) {
      collections = replaced;
      replacedRequests += 1;
    } else {
      const folderPath = Array.isArray(r.folderPath) ? r.folderPath.filter((p): p is string => typeof p === "string") : [];
      collections = addByPath(collections, typeof r.collectionName === "string" && r.collectionName ? r.collectionName : "Imported requests", folderPath, node);
      addedRequests += 1;
    }
  }

  return {
    flows: flows.list,
    suites: suites.list,
    collections,
    counts: { flows: [flows.added, flows.replaced], suites: [suites.added, suites.replaced], requests: [addedRequests, replacedRequests] },
  };
}

export function describeImport(name: string, c: FlowsImport["counts"]): string {
  const part = (label: string, [a, r]: [number, number]) => (a || r ? `${label}: ${a} added, ${r} updated` : null);
  const parts = [part("flows", c.flows), part("suites", c.suites), part("saved requests", c.requests)].filter(Boolean);
  return `Imported ${name}: ${parts.join("; ") || "nothing new"}.`;
}
