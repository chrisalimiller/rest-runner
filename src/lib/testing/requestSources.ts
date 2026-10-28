import { load } from "../storage";
import type { RequestDef } from "../types";

/** A saved request (or one of its examples) that a test case can be made from. */
export interface PickableRequest {
  id: string;
  /** Collection and folder names, then the request name; examples add their own name last. */
  path: string[];
  request: RequestDef;
  isExample: boolean;
}

const COLLECTIONS_KEY = "rest-runner.collections";
const SAVED_KEY = "rest-runner.saved";

interface TreeLike {
  kind?: string;
  id?: string;
  name?: string;
  items?: TreeLike[];
  request?: RequestDef;
  examples?: { id: string; name: string; request: RequestDef }[];
}

function isRequest(r: unknown): r is RequestDef {
  return !!r && typeof (r as RequestDef).url === "string" && typeof (r as RequestDef).method === "string";
}

function walk(items: unknown, path: string[], out: PickableRequest[]) {
  if (!Array.isArray(items)) return;
  for (const item of items as (TreeLike | null)[]) {
    if (!item || typeof item !== "object") continue;
    if (item.kind === "folder" && Array.isArray(item.items)) {
      walk(item.items, [...path, item.name ?? "Folder"], out);
    } else if (item.kind === "request" && isRequest(item.request)) {
      const req = item.request;
      out.push({ id: req.id, path: [...path, req.name], request: req, isExample: false });
      for (const ex of Array.isArray(item.examples) ? item.examples : []) {
        if (ex && isRequest(ex.request)) out.push({ id: ex.id, path: [...path, req.name, ex.name], request: { ...ex.request, name: `${req.name} – ${ex.name}` }, isExample: true });
      }
    }
  }
}

/**
 * Lists saved requests from the Requests section. Reads collections when they exist
 * (folders and examples included), otherwise the older flat list of saved requests.
 */
export function listPickableRequests(): PickableRequest[] {
  const collections = load<TreeLike[] | null>(COLLECTIONS_KEY, null);
  if (Array.isArray(collections)) {
    const out: PickableRequest[] = [];
    for (const c of collections) if (c && typeof c === "object") walk(c.items, [c.name ?? "Collection"], out);
    return out;
  }
  const saved = load<unknown[]>(SAVED_KEY, []);
  return (Array.isArray(saved) ? saved : []).filter(isRequest).map((r) => ({ id: r.id, path: [r.name], request: r, isExample: false }));
}
