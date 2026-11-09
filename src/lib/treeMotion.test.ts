import { describe, expect, it } from "vitest";
import { countVisibleRows, MAX_ANIMATED_ROWS, shouldAnimateToggle } from "./treeMotion";

const base = { rows: 5, reducedMotion: false, sinceLastToggleMs: 1000 };

describe("shouldAnimateToggle", () => {
  it("animates small subtrees", () => expect(shouldAnimateToggle(base)).toBe(true));
  it("skips reduced motion, drag, empty, huge and rapid toggles", () => {
    expect(shouldAnimateToggle({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldAnimateToggle({ ...base, dragging: true })).toBe(false);
    expect(shouldAnimateToggle({ ...base, rows: 0 })).toBe(false);
    expect(shouldAnimateToggle({ ...base, rows: MAX_ANIMATED_ROWS + 1 })).toBe(false);
    expect(shouldAnimateToggle({ ...base, sinceLastToggleMs: 50 })).toBe(false);
  });
});

describe("countVisibleRows", () => {
  const req = (id: string, ex = 0) => ({ kind: "request", id, examples: Array.from({ length: ex }) }) as never;
  const folder = (id: string, items: unknown[]) => ({ kind: "folder", id, items }) as never;
  it("counts only expanded descendants", () => {
    const items = [req("a", 2), folder("f", [req("b"), req("c")])];
    expect(countVisibleRows(items, new Set())).toBe(2);
    expect(countVisibleRows(items, new Set(["a", "f"]))).toBe(6);
  });
  it("stops past the cap", () => {
    const items = Array.from({ length: 100 }, (_, i) => req(String(i)));
    expect(countVisibleRows(items, new Set())).toBeLessThanOrEqual(MAX_ANIMATED_ROWS + 1);
  });
});
