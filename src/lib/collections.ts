import { newId } from "./ids";
import type { RequestDef, ResponseResult } from "./types";

/**
 * Saved requests live in collections. A collection holds folders and requests,
 * and folders can nest. Each saved request can keep any number of examples:
 * named variants of the request (different params, headers or body) with an
 * optional sample response.
 *
 * Ids are unique across the whole tree: collection, folder, request and example
 * ids never clash, so one id is enough to find any node.
 */

export interface SampleResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

/** A named variant of a saved request. `request.id` equals the example's `id`. */
export interface RequestExample {
  id: string;
  name: string;
  request: RequestDef;
  response?: SampleResponse;
}

export interface RequestNode {
  kind: "request";
  /** Same as request.id. */
  id: string;
  request: RequestDef;
  examples: RequestExample[];
}

export interface FolderNode {
  kind: "folder";
  id: string;
  name: string;
  items: TreeNode[];
}

export type TreeNode = FolderNode | RequestNode;

export interface Collection {
  id: string;
  name: string;
  items: TreeNode[];
}

/** Where a new item goes: the top of a collection (folderId null) or inside a folder. */
export interface Destination {
  collectionId: string;
  folderId: string | null;
}

/** A saved request with where it sits, for pickers and lists. */
export interface RequestEntry {
  collectionId: string;
  collectionName: string;
  /** Folder names from the collection down to the request. */
  folderPath: string[];
  request: RequestDef;
  examples: RequestExample[];
}

export type Located =
  | { kind: "collection"; collection: Collection }
  | { kind: "folder"; collection: Collection; folder: FolderNode; path: FolderNode[] }
  | { kind: "request"; collection: Collection; node: RequestNode; path: FolderNode[] }
  | { kind: "example"; collection: Collection; node: RequestNode; example: RequestExample; path: FolderNode[] };

export const DEFAULT_COLLECTION_NAME = "My requests";

export function newCollection(name: string): Collection {
  return { id: newId(), name, items: [] };
}

export function newFolder(name: string): FolderNode {
  return { kind: "folder", id: newId(), name, items: [] };
}

export function requestNode(request: RequestDef, examples: RequestExample[] = []): RequestNode {
  return { kind: "request", id: request.id, request, examples };
}

export function sampleFromResponse(res: ResponseResult): SampleResponse {
  return { status: res.status, statusText: res.statusText, headers: res.headers, body: res.body };
}

/** Turns the old flat list of saved requests into one collection. */
export function migrateSavedRequests(saved: RequestDef[]): Collection[] {
  if (saved.length === 0) return [];
  return [{ ...newCollection(DEFAULT_COLLECTION_NAME), items: saved.map((r) => requestNode(r)) }];
}

/** Finds any node by id. */
export function locate(collections: Collection[], id: string): Located | null {
  for (const collection of collections) {
    if (collection.id === id) return { kind: "collection", collection };
    const found = locateIn(collection, collection.items, id, []);
    if (found) return found;
  }
  return null;
}

function locateIn(collection: Collection, items: TreeNode[], id: string, path: FolderNode[]): Located | null {
  for (const item of items) {
    if (item.kind === "folder") {
      if (item.id === id) return { kind: "folder", collection, folder: item, path };
      const found = locateIn(collection, item.items, id, [...path, item]);
      if (found) return found;
    } else {
      if (item.id === id) return { kind: "request", collection, node: item, path };
      const example = item.examples.find((e) => e.id === id);
      if (example) return { kind: "example", collection, node: item, example, path };
    }
  }
  return null;
}

/** Every saved request in tree order, with its collection and folder path. */
export function listRequests(collections: Collection[]): RequestEntry[] {
  const out: RequestEntry[] = [];
  const walk = (c: Collection, items: TreeNode[], path: string[]) => {
    for (const item of items) {
      if (item.kind === "folder") walk(c, item.items, [...path, item.name]);
      else out.push({ collectionId: c.id, collectionName: c.name, folderPath: path, request: item.request, examples: item.examples });
    }
  };
  for (const c of collections) walk(c, c.items, []);
  return out;
}

/** All requests and examples in a list of nodes, flattened (used for counts and id checks). */
function allIds(items: TreeNode[]): string[] {
  return items.flatMap((i) => (i.kind === "folder" ? [i.id, ...allIds(i.items)] : [i.id, ...i.examples.map((e) => e.id)]));
}

// ---- Immutable tree edits -------------------------------------------------

function mapItems(items: TreeNode[], fn: (node: TreeNode) => TreeNode | null): TreeNode[] {
  const out: TreeNode[] = [];
  for (const item of items) {
    const mapped = fn(item);
    if (mapped === null) continue;
    out.push(mapped.kind === "folder" ? { ...mapped, items: mapItems(mapped.items, fn) } : mapped);
  }
  return out;
}

/** Applies fn to every node in every collection; return null to remove a node. */
function mapTree(collections: Collection[], fn: (node: TreeNode) => TreeNode | null): Collection[] {
  return collections.map((c) => ({ ...c, items: mapItems(c.items, fn) }));
}

/** Adds nodes at a destination (end of the collection or folder). */
export function insertAt(collections: Collection[], dest: Destination, nodes: TreeNode[]): Collection[] {
  return collections.map((c) => {
    if (c.id !== dest.collectionId) return c;
    if (dest.folderId === null) return { ...c, items: [...c.items, ...nodes] };
    return {
      ...c,
      items: mapItems(c.items, (n) => (n.kind === "folder" && n.id === dest.folderId ? { ...n, items: [...n.items, ...nodes] } : n)),
    };
  });
}

/** Replaces a saved request's definition, keeping its examples. */
export function updateRequest(collections: Collection[], def: RequestDef): Collection[] {
  return mapTree(collections, (n) => (n.kind === "request" && n.id === def.id ? { ...n, request: def } : n));
}

/** Replaces an example's request (and name from it), keeping its sample response. */
export function updateExample(collections: Collection[], def: RequestDef): Collection[] {
  return mapTree(collections, (n) =>
    n.kind === "request" && n.examples.some((e) => e.id === def.id)
      ? { ...n, examples: n.examples.map((e) => (e.id === def.id ? { ...e, name: def.name, request: def } : e)) }
      : n,
  );
}

/** Adds an example to a saved request. The example gets fresh ids. */
export function addExample(
  collections: Collection[],
  requestId: string,
  name: string,
  def: RequestDef,
  response?: SampleResponse,
): { collections: Collection[]; example: RequestExample } {
  const id = newId();
  const example: RequestExample = { id, name, request: { ...structuredClone(def), id, name }, ...(response ? { response } : {}) };
  const next = mapTree(collections, (n) => (n.kind === "request" && n.id === requestId ? { ...n, examples: [...n.examples, example] } : n));
  return { collections: next, example };
}

/** Sets or clears an example's sample response. */
export function setExampleResponse(collections: Collection[], exampleId: string, response: SampleResponse | undefined): Collection[] {
  return mapTree(collections, (n) => {
    if (n.kind !== "request" || !n.examples.some((e) => e.id === exampleId)) return n;
    return {
      ...n,
      examples: n.examples.map((e) => {
        if (e.id !== exampleId) return e;
        const copy: RequestExample = { ...e, response };
        if (!response) delete copy.response;
        return copy;
      }),
    };
  });
}

/** Renames a collection, folder, request or example. */
export function rename(collections: Collection[], id: string, name: string): Collection[] {
  return collections.map((c) => {
    if (c.id === id) return { ...c, name };
    return {
      ...c,
      items: mapItems(c.items, (n) => {
        if (n.id === id) return n.kind === "folder" ? { ...n, name } : { ...n, request: { ...n.request, name } };
        if (n.kind === "request" && n.examples.some((e) => e.id === id)) {
          return { ...n, examples: n.examples.map((e) => (e.id === id ? { ...e, name, request: { ...e.request, name } } : e)) };
        }
        return n;
      }),
    };
  });
}

/** Removes a collection, folder (with its contents), request (with its examples) or example. */
export function remove(collections: Collection[], id: string): Collection[] {
  return mapTree(
    collections.filter((c) => c.id !== id),
    (n) => {
      if (n.id === id) return null;
      if (n.kind === "request" && n.examples.some((e) => e.id === id)) return { ...n, examples: n.examples.filter((e) => e.id !== id) };
      return n;
    },
  );
}

/**
 * Like `remove`, but also returns a function that puts the item back where it was
 * (same parent, same position) in whatever the collections look like by then.
 * Used for Undo; returns null when the id isn't there.
 */
export function removeWithRestore(collections: Collection[], id: string): { collections: Collection[]; restore: (current: Collection[]) => Collection[] } | null {
  const found = locate(collections, id);
  if (!found) return null;
  const next = remove(collections, id);
  const insertInto = (items: TreeNode[], parentId: string | null, index: number, node: TreeNode, collectionItems: TreeNode[]): TreeNode[] => {
    const put = (list: TreeNode[]) => (list.some((x) => x.id === node.id) ? list : [...list.slice(0, index), node, ...list.slice(index)]);
    if (parentId === null) return put(items);
    let placed = false;
    const walk = (list: TreeNode[]): TreeNode[] =>
      list.map((n) => {
        if (n.kind !== "folder") return n;
        if (n.id === parentId) {
          placed = true;
          return { ...n, items: put(n.items) };
        }
        return { ...n, items: walk(n.items) };
      });
    const out = walk(items);
    // The folder is gone too: put the item at the top of the collection instead.
    return placed ? out : [...collectionItems, node];
  };

  if (found.kind === "collection") {
    const index = collections.findIndex((c) => c.id === id);
    const collection = found.collection;
    return {
      collections: next,
      restore: (cur) => (cur.some((c) => c.id === id) ? cur : [...cur.slice(0, index), collection, ...cur.slice(index)]),
    };
  }
  if (found.kind === "example") {
    const index = found.node.examples.findIndex((e) => e.id === id);
    const example = found.example;
    const requestId = found.node.id;
    const addBack = (items: TreeNode[]): TreeNode[] =>
      items.map((n) => {
        if (n.kind === "folder") return { ...n, items: addBack(n.items) };
        if (n.id !== requestId || n.examples.some((e) => e.id === id)) return n;
        return { ...n, examples: [...n.examples.slice(0, index), example, ...n.examples.slice(index)] };
      });
    return { collections: next, restore: (cur) => cur.map((c) => ({ ...c, items: addBack(c.items) })) };
  }
  const node: TreeNode = found.kind === "folder" ? found.folder : found.node;
  const path = found.path;
  const parentId = path.length ? path[path.length - 1].id : null;
  const siblings = parentId === null ? found.collection.items : path[path.length - 1].items;
  const index = siblings.findIndex((x) => x.id === id);
  const collectionId = found.collection.id;
  return {
    collections: next,
    restore: (cur) => cur.map((c) => (c.id === collectionId ? { ...c, items: insertInto(c.items, parentId, index, node, c.items) } : c)),
  };
}

/** Deep copy of a node with new ids throughout. */
function cloneWithNewIds(node: TreeNode): TreeNode {
  if (node.kind === "folder") return { ...node, id: newId(), items: node.items.map(cloneWithNewIds) };
  const id = newId();
  return {
    kind: "request",
    id,
    request: { ...structuredClone(node.request), id },
    examples: node.examples.map((e) => {
      const eid = newId();
      return { ...structuredClone(e), id: eid, request: { ...structuredClone(e.request), id: eid } };
    }),
  };
}

/** Copies a folder, request or example and places the copy right after the original. Returns the copy's id. */
export function duplicate(collections: Collection[], id: string): { collections: Collection[]; newId: string | null } {
  const found = locate(collections, id);
  if (!found || found.kind === "collection") return { collections, newId: null };
  if (found.kind === "example") {
    const r = addExample(collections, found.node.id, `${found.example.name} copy`, found.example.request, found.example.response);
    return { collections: r.collections, newId: r.example.id };
  }
  const original = found.kind === "folder" ? found.folder : found.node;
  const copy = cloneWithNewIds(original);
  if (copy.kind === "folder") copy.name = `${copy.name} copy`;
  else copy.request.name = `${copy.request.name} copy`;
  const insertAfter = (items: TreeNode[]): TreeNode[] =>
    items.flatMap((n) => {
      if (n.id === id) return [n, copy];
      return [n.kind === "folder" ? { ...n, items: insertAfter(n.items) } : n];
    });
  return { collections: collections.map((c) => ({ ...c, items: insertAfter(c.items) })), newId: copy.id };
}

/** True if a folder or request can be moved to the destination (a folder cannot go inside itself). */
export function canMove(collections: Collection[], id: string, dest: Destination): boolean {
  const found = locate(collections, id);
  if (!found || (found.kind !== "folder" && found.kind !== "request")) return false;
  if (dest.folderId === null) return true;
  if (found.kind === "folder") return dest.folderId !== id && !allIds(found.folder.items).includes(dest.folderId);
  return true;
}

/** Moves a folder or request to the end of another collection or folder. */
export function move(collections: Collection[], id: string, dest: Destination): Collection[] {
  if (!canMove(collections, id, dest)) return collections;
  const found = locate(collections, id)!;
  const node = found.kind === "folder" ? found.folder : (found as Extract<Located, { kind: "request" }>).node;
  return insertAt(remove(collections, id), dest, [node]);
}

/** Every place a new item can go, as labels like "Collection / Folder / Sub". */
export function destinations(collections: Collection[]): { dest: Destination; label: string; depth: number }[] {
  const out: { dest: Destination; label: string; depth: number }[] = [];
  const walk = (c: Collection, items: TreeNode[], label: string, depth: number) => {
    for (const item of items) {
      if (item.kind !== "folder") continue;
      const l = `${label} / ${item.name}`;
      out.push({ dest: { collectionId: c.id, folderId: item.id }, label: l, depth });
      walk(c, item.items, l, depth + 1);
    }
  };
  for (const c of collections) {
    out.push({ dest: { collectionId: c.id, folderId: null }, label: c.name, depth: 0 });
    walk(c, c.items, c.name, 1);
  }
  return out;
}

/** Counts the requests in a list of nodes, including those in sub-folders. */
export function countRequests(items: TreeNode[]): number {
  return items.reduce((n, i) => n + (i.kind === "folder" ? countRequests(i.items) : 1), 0);
}

// ---- Loading and validating ----------------------------------------------

function isRequestDef(x: unknown): x is RequestDef {
  const r = x as RequestDef;
  return !!r && typeof r.id === "string" && typeof r.url === "string" && typeof r.method === "string" && Array.isArray(r.headers) && Array.isArray(r.params);
}

function cleanNode(x: unknown): TreeNode | null {
  const n = x as TreeNode;
  if (!n || typeof n !== "object") return null;
  if (n.kind === "folder" && typeof n.id === "string") {
    return { kind: "folder", id: n.id, name: typeof n.name === "string" ? n.name : "Folder", items: cleanItems(n.items) };
  }
  if (n.kind === "request" && isRequestDef(n.request)) {
    const examples = (Array.isArray(n.examples) ? n.examples : [])
      .filter((e) => e && typeof e.id === "string" && isRequestDef(e.request))
      .map((e) => ({ ...e, name: typeof e.name === "string" ? e.name : "Example", request: { ...e.request, id: e.id } }));
    return { kind: "request", id: n.request.id, request: n.request, examples };
  }
  return null;
}

function cleanItems(items: unknown): TreeNode[] {
  return Array.isArray(items) ? items.map(cleanNode).filter((n): n is TreeNode => n !== null) : [];
}

/** Keeps only well-formed collections and nodes (for loading from storage or a file). */
export function cleanCollections(x: unknown): Collection[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((c) => c && typeof c.id === "string")
    .map((c) => ({ id: c.id, name: typeof c.name === "string" ? c.name : "Collection", items: cleanItems(c.items) }));
}

export { isRequestDef };
