/** Undo/redo as plain data: snapshots before and after the one on screen. */
export interface UndoStack<T> {
  past: T[];
  present: T;
  future: T[];
  /** What the last push was about and when, so a burst of the same edit (typing a name) counts once. */
  lastGroup: string | null;
  lastAt: number;
}

export const UNDO_LIMIT = 50;
/** Pushes of the same group closer together than this are one undo step. */
export const GROUP_WINDOW_MS = 1000;

export function createUndoStack<T>(present: T): UndoStack<T> {
  return { past: [], present, future: [], lastGroup: null, lastAt: 0 };
}

/**
 * Records `next` as the new present. A new edit clears redo; the history keeps at most `limit` snapshots.
 * Pushing the value that is already present does nothing.
 */
export function pushUndo<T>(stack: UndoStack<T>, next: T, opts: { group?: string; at?: number; limit?: number } = {}): UndoStack<T> {
  if (Object.is(next, stack.present)) return stack;
  const at = opts.at ?? Date.now();
  const limit = opts.limit ?? UNDO_LIMIT;
  const group = opts.group ?? null;
  const merge = group !== null && group === stack.lastGroup && at - stack.lastAt <= GROUP_WINDOW_MS && stack.past.length > 0;
  const past = merge ? stack.past : [...stack.past, stack.present].slice(-limit);
  return { past, present: next, future: [], lastGroup: group, lastAt: at };
}

export function undo<T>(stack: UndoStack<T>): UndoStack<T> {
  if (stack.past.length === 0) return stack;
  const previous = stack.past[stack.past.length - 1];
  return { past: stack.past.slice(0, -1), present: previous, future: [stack.present, ...stack.future], lastGroup: null, lastAt: 0 };
}

export function redo<T>(stack: UndoStack<T>): UndoStack<T> {
  if (stack.future.length === 0) return stack;
  const [next, ...rest] = stack.future;
  return { past: [...stack.past, stack.present], present: next, future: rest, lastGroup: null, lastAt: 0 };
}

export const canUndo = (s: UndoStack<unknown>) => s.past.length > 0;
export const canRedo = (s: UndoStack<unknown>) => s.future.length > 0;
