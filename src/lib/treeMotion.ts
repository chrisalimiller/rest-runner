import type { TreeNode } from "./collections";

/** Subtrees taller than this many rows toggle instantly: animating a long list janks. */
export const MAX_ANIMATED_ROWS = 40;
/** A toggle this soon after the previous one (key repeat, double click) skips animation. */
export const RAPID_TOGGLE_MS = 250;

export interface AnimateInput {
  rows: number;
  reducedMotion: boolean;
  /** ms since the previous toggle of this subtree. */
  sinceLastToggleMs: number;
  /** True while a drag or reorder is in progress. */
  dragging?: boolean;
}

/** Whether an expand/collapse should animate. Pure so it can be unit tested. */
export function shouldAnimateToggle({ rows, reducedMotion, sinceLastToggleMs, dragging }: AnimateInput): boolean {
  if (reducedMotion || dragging) return false;
  if (rows <= 0 || rows > MAX_ANIMATED_ROWS) return false;
  if (sinceLastToggleMs < RAPID_TOGGLE_MS) return false;
  return true;
}

/** Number of rows currently visible in a subtree given the expanded ids (stops early past `cap`). */
export function countVisibleRows(items: TreeNode[], expanded: Set<string>, cap = MAX_ANIMATED_ROWS + 1): number {
  let n = 0;
  for (const item of items) {
    n += 1;
    if (item.kind === "folder") {
      if (expanded.has(item.id)) n += countVisibleRows(item.items, expanded, cap - n);
    } else if (expanded.has(item.id)) {
      n += item.examples.length;
    }
    if (n >= cap) return n;
  }
  return n;
}
