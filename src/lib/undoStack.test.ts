import { describe, expect, it } from "vitest";
import { canRedo, canUndo, createUndoStack, GROUP_WINDOW_MS, pushUndo, redo, undo, UNDO_LIMIT } from "./undoStack";

describe("undo stack", () => {
  it("pushes, undoes and redoes", () => {
    let s = createUndoStack({ n: 0 });
    const a = { n: 1 };
    const b = { n: 2 };
    s = pushUndo(s, a);
    s = pushUndo(s, b);
    expect(s.present).toBe(b);
    s = undo(s);
    expect(s.present).toBe(a);
    s = undo(s);
    expect(s.present).toEqual({ n: 0 });
    expect(canUndo(s)).toBe(false);
    s = redo(s);
    expect(s.present).toBe(a);
    expect(canRedo(s)).toBe(true);
  });

  it("clears redo after a new edit", () => {
    let s = pushUndo(createUndoStack(0), 1);
    s = pushUndo(s, 2);
    s = undo(s);
    expect(canRedo(s)).toBe(true);
    s = pushUndo(s, 5);
    expect(canRedo(s)).toBe(false);
    expect(s.past).toEqual([0, 1]);
  });

  it("keeps at most 50 snapshots", () => {
    let s = createUndoStack(0);
    for (let i = 1; i <= 80; i++) s = pushUndo(s, i);
    expect(s.past).toHaveLength(UNDO_LIMIT);
    expect(s.past[0]).toBe(30);
    expect(s.present).toBe(80);
  });

  it("does nothing when undo/redo have nothing to do, or the value is unchanged", () => {
    const s = createUndoStack("a");
    expect(undo(s)).toBe(s);
    expect(redo(s)).toBe(s);
    expect(pushUndo(s, "a")).toBe(s);
  });

  it("merges quick pushes of the same group into one step", () => {
    let s = createUndoStack("");
    s = pushUndo(s, "a", { group: "name", at: 0 });
    s = pushUndo(s, "ab", { group: "name", at: 200 });
    s = pushUndo(s, "abc", { group: "name", at: 400 });
    expect(s.past).toEqual([""]);
    s = pushUndo(s, "abcd", { group: "name", at: 400 + GROUP_WINDOW_MS + 1 });
    expect(s.past).toEqual(["", "abc"]);
    s = pushUndo(s, "x", { group: "other", at: 400 + GROUP_WINDOW_MS + 2 });
    expect(s.past).toHaveLength(3);
  });
});
