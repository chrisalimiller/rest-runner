import { cleanCollections, locate, type Collection } from "../collections";
import { addByPath, mergeById, replaceNode, type ExportedRequest } from "../flows/flowFile";
import { validateImportedMethods } from "../importMethods";
import { cleanTools } from "./tools";
import type { Tool } from "./types";

/** File format for exporting tools together with the saved requests they use. Same shape and rules as the flows file. */
export interface ToolsFile {
  app: "rest-runner";
  kind: "tools";
  version: 1;
  exportedAt: string;
  tools: Tool[];
  requests: ExportedRequest[];
}

/** The saved requests the given tools call. A call to an example brings its whole request along. */
export function requestsUsedBy(tools: Tool[], collections: Collection[]): ExportedRequest[] {
  const out = new Map<string, ExportedRequest>();
  for (const t of tools) {
    for (const c of t.calls) {
      const found = locate(collections, c.requestId);
      if (!found || (found.kind !== "request" && found.kind !== "example")) continue;
      out.set(found.node.id, { collectionName: found.collection.name, folderPath: found.path.map((p) => p.name), node: found.node });
    }
  }
  return [...out.values()];
}

export function toToolsFile(tools: Tool[], collections: Collection[]): string {
  const file: ToolsFile = { app: "rest-runner", kind: "tools", version: 1, exportedAt: new Date().toISOString(), tools, requests: requestsUsedBy(tools, collections) };
  return JSON.stringify(file, null, 2);
}

export interface ToolsImport {
  tools: Tool[];
  collections: Collection[];
  /** Ids of imported tools that replaced one already here: their unsaved Build edits no longer match. */
  replacedIds: string[];
  counts: { tools: [added: number, replaced: number]; requests: [number, number] };
}

/** Merges the saved requests of a file into the collections: the same id is replaced, new ones go back where they sat (made if missing). */
export function mergeRequests(collections: Collection[], incoming: unknown): { collections: Collection[]; counts: [number, number] } {
  let next = collections;
  let added = 0;
  let replacedCount = 0;
  for (const r of Array.isArray(incoming) ? (incoming as Partial<ExportedRequest>[]) : []) {
    if (!r || typeof r !== "object") continue;
    const [node] = cleanCollections([{ id: "import", name: "import", items: [r.node] }])[0].items;
    if (!node || node.kind !== "request") continue;
    const replaced = replaceNode(next, node);
    if (replaced) {
      next = replaced;
      replacedCount += 1;
    } else {
      const folderPath = Array.isArray(r.folderPath) ? r.folderPath.filter((p): p is string => typeof p === "string") : [];
      next = addByPath(next, typeof r.collectionName === "string" && r.collectionName ? r.collectionName : "Imported requests", folderPath, node);
      added += 1;
    }
  }
  return { collections: next, counts: [added, replacedCount] };
}

/** The shared part of a tools file and a workspace file: clean the tools, then merge them and their requests. */
export function mergeToolsAndRequests(incomingTools: unknown, incomingRequests: unknown, current: { tools: Tool[]; collections: Collection[] }): ToolsImport {
  const cleaned = cleanTools(incomingTools);
  const tools = mergeById(current.tools, cleaned);
  const reqs = mergeRequests(current.collections, incomingRequests);
  const replacedIds = cleaned.filter((t) => current.tools.some((x) => x.id === t.id)).map((t) => t.id);
  return { tools: tools.list, collections: reqs.collections, replacedIds, counts: { tools: [tools.added, tools.replaced], requests: reqs.counts } };
}

/**
 * Merges an exported tools file. A tool or saved request with the same id is replaced; everything else is added.
 * Tools are checked with cleanTools, so a broken file cannot put a malformed tool on screen.
 */
export function importToolsFile(text: string, current: { tools: Tool[]; collections: Collection[] }): ToolsImport {
  let data: Partial<ToolsFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!data || data.app !== "rest-runner" || data.kind !== "tools") throw new Error("This is not a REST Runner tools file.");
  validateImportedMethods([data.requests]);
  return mergeToolsAndRequests(data.tools, data.requests, current);
}

export function describeToolsImport(name: string, c: ToolsImport["counts"]): string {
  const part = (label: string, [a, r]: [number, number]) => (a || r ? `${label}: ${a} added, ${r} updated` : null);
  const parts = [part("tools", c.tools), part("saved requests", c.requests)].filter(Boolean);
  return `Imported ${name}: ${parts.join("; ") || "nothing new"}.`;
}
