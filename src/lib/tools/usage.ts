import { locate, type Collection, type TreeNode } from "../collections";
import type { Tool } from "./types";

/** Which tools use a saved request (or example): for "Used by 2 tools" in Requests and the warning before deleting one. */

/** The tools that have at least one call to any of these request or example ids, in the order the tools are listed. */
export function toolsUsingRequests(tools: readonly Tool[], requestIds: Iterable<string>): Tool[] {
  const ids = new Set(requestIds);
  if (ids.size === 0) return [];
  return tools.filter((t) => t.calls.some((c) => ids.has(c.requestId)));
}

/** The ids of every request and example inside these tree nodes (a request, a folder, or a whole collection's items). */
export function requestIdsIn(nodes: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (items: readonly TreeNode[]) => {
    for (const n of items) {
      if (n.kind === "folder") walk(n.items);
      else out.push(n.id, ...n.examples.map((e) => e.id));
    }
  };
  walk(nodes);
  return out;
}

/** The request and example ids that go away when this tree item (collection, folder, request or example) is deleted. */
export function idsRemovedBy(collections: readonly Collection[], id: string): string[] {
  const found = locate(collections as Collection[], id);
  if (!found) return [];
  switch (found.kind) {
    case "collection":
      return requestIdsIn(found.collection.items);
    case "folder":
      return requestIdsIn(found.folder.items);
    case "request":
      return [found.node.id, ...found.node.examples.map((e) => e.id)];
    case "example":
      return [found.example.id];
  }
}

/** "Used by 1 tool" / "Used by 3 tools". Empty when none. */
export function usedByLabel(count: number): string {
  return count === 0 ? "" : `Used by ${count} tool${count === 1 ? "" : "s"}`;
}

/** The warning before deleting something tools use: names the tools. */
export function deleteWarning(what: string, used: readonly Pick<Tool, "name">[]): string {
  const names = used.map((t) => `"${t.name || "(unnamed)"}"`);
  const list = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return `${what} is used by ${used.length === 1 ? "the tool" : "the tools"} ${list}. After deleting it, ${used.length === 1 ? "that tool's" : "those tools'"} calls show "Request missing" until you pick another request.`;
}
