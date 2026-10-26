import { describe, expect, it } from "vitest";
import { dropIndex, moveItem, reorderAnnouncement } from "./reorder";

describe("moveItem", () => {
  it("moves an item and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 9)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 1, -4)).toEqual(["b", "a", "c"]);
  });

  it("returns the same list when nothing moves", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 5, 0)).toBe(list);
  });
});

describe("dropIndex", () => {
  it("counts the other items above the pointer", () => {
    const middles = [10, 50, 90];
    expect(dropIndex(middles, 0, 5)).toBe(0);
    expect(dropIndex(middles, 0, 60)).toBe(1);
    expect(dropIndex(middles, 0, 200)).toBe(2);
    expect(dropIndex(middles, 2, 20)).toBe(1);
  });
});

describe("reorderAnnouncement", () => {
  it("names the case and its position", () => {
    expect(reorderAnnouncement("Login", "move", 2, 5)).toBe("Login, position 2 of 5.");
    expect(reorderAnnouncement("Login", "drop", 2, 5)).toContain("Dropped Login at position 2 of 5");
    expect(reorderAnnouncement("Login", "lift", 1, 5)).toContain("Space to drop");
    expect(reorderAnnouncement("Login", "cancel", 1, 5)).toContain("back at position 1");
  });
});
