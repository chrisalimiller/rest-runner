import { describe, expect, it } from "vitest";
import { nextFocusIndex } from "./useFocusTrap";

describe("nextFocusIndex", () => {
  it("moves forward and back, wrapping at the ends", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 2, true)).toBe(1);
  });

  it("starts at an end when focus is outside, and does nothing with nothing to focus", () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
  });
});
