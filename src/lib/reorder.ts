/** A copy of the list with the item at `from` moved to index `to` (clamped). The same list when nothing moves. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || from === target) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Where a dragged item belongs: the number of the other items whose middle is above the pointer.
 * `middles` are the vertical middles of all items in their current order, the dragged one included.
 */
export function dropIndex(middles: number[], dragged: number, pointerY: number): number {
  return middles.filter((m, i) => i !== dragged && m < pointerY).length;
}

export type ReorderPhase = "lift" | "move" | "drop" | "cancel";

/** What a screen reader hears while a case is picked up, moved and dropped. */
export function reorderAnnouncement(name: string, phase: ReorderPhase, position: number, total: number): string {
  switch (phase) {
    case "lift":
      return `Picked up ${name}, position ${position} of ${total}. Use the arrow keys to move it, Space to drop, Escape to cancel.`;
    case "move":
      return `${name}, position ${position} of ${total}.`;
    case "drop":
      return `Dropped ${name} at position ${position} of ${total}.`;
    case "cancel":
      return `Cancelled. ${name} is back at position ${position} of ${total}.`;
  }
}
