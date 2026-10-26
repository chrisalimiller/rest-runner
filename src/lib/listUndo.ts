/** Helpers for "delete, then Undo" on lists of things with an id. */

export function removeById<T extends { id: string }>(list: T[], id: string): { list: T[]; item: T; index: number } | null {
  const index = list.findIndex((x) => x.id === id);
  if (index === -1) return null;
  return { list: list.filter((x) => x.id !== id), item: list[index], index };
}

/** Puts an item back at its old position in the list as it is now. Does nothing if it is already there. */
export function reinsert<T extends { id: string }>(list: T[], item: T, index: number): T[] {
  if (list.some((x) => x.id === item.id)) return list;
  const at = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, at), item, ...list.slice(at)];
}
