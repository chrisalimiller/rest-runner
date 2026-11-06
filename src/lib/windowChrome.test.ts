import { describe, expect, it } from "vitest";
import { viewportOutOfStep } from "./windowChrome";

describe("viewportOutOfStep", () => {
  it("accepts a viewport that matches the window", () => {
    expect(viewportOutOfStep(1280, 820, 1280, 820)).toBe(false);
    expect(viewportOutOfStep(1275, 816, 1280, 820)).toBe(false);
  });
  it("flags a viewport squeezed into the title bar", () => {
    expect(viewportOutOfStep(1280, 28, 1280, 820)).toBe(true);
    expect(viewportOutOfStep(0, 0, 1280, 820)).toBe(true);
  });
  it("ignores an unknown window size", () => {
    expect(viewportOutOfStep(1280, 28, 0, 0)).toBe(false);
  });
});
