import { describe, expect, it } from "vitest";
import { keepSelected } from "./selection";

describe("keepSelected", () => {
  it("keeps a shown selection, else moves to the first shown item", () => {
    expect(keepSelected(2, [1, 2, 3])).toBe(2);
    expect(keepSelected(5, [1, 2, 3])).toBe(1);
    expect(keepSelected(null, [4])).toBe(4);
    expect(keepSelected(2, [])).toBeNull();
  });
});
