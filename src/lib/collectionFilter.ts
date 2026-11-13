import type { Collection, RequestNode, TreeNode } from "./collections";

/**
 * Narrows the sidebar tree to what matches a search. A collection or folder whose own name matches keeps everything
 * inside it; otherwise only the branches with a matching request or example survive. A request matches by name or URL.
 * An empty search returns the collections as they are.
 */
export function filterCollections(collections: Collection[], query: string): Collection[] {
  const q = query.trim().toLowerCase();
  if (q === "") return collections;
  const has = (text: string) => text.toLowerCase().includes(q);

  const request = (node: RequestNode): RequestNode | null => {
    if (has(node.request.name) || has(node.request.url)) return node;
    const examples = node.examples.filter((ex) => has(ex.name));
    return examples.length > 0 ? { ...node, examples } : null;
  };
  const items = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of list) {
      if (node.kind === "request") {
        const kept = request(node);
        if (kept) out.push(kept);
      } else if (has(node.name)) out.push(node);
      else {
        const inner = items(node.items);
        if (inner.length > 0) out.push({ ...node, items: inner });
      }
    }
    return out;
  };

  const out: Collection[] = [];
  for (const collection of collections) {
    if (has(collection.name)) out.push(collection);
    else {
      const inner = items(collection.items);
      if (inner.length > 0) out.push({ ...collection, items: inner });
    }
  }
  return out;
}

/** Every collection, folder and request id in the tree, so a filtered tree can be shown fully open. */
export function allNodeIds(collections: Collection[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      ids.add(node.id);
      if (node.kind === "folder") walk(node.items);
    }
  };
  for (const collection of collections) {
    ids.add(collection.id);
    walk(collection.items);
  }
  return ids;
}
