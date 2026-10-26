import { describe, expect, it } from "vitest";
import { topBarLayout } from "./topBar";

describe("topBarLayout", () => {
  it("collapses the search below 1366 px", () => {
    expect(topBarLayout(1440, 2).compactSearch).toBe(false);
    expect(topBarLayout(1366, 2).compactSearch).toBe(false);
    expect(topBarLayout(1280, 2).compactSearch).toBe(true);
  });

  it("uses a dropdown for more than 3 environments or a window under 1200 px", () => {
    expect(topBarLayout(1440, 3).envDropdown).toBe(false);
    expect(topBarLayout(1440, 4).envDropdown).toBe(true);
    expect(topBarLayout(1199, 2).envDropdown).toBe(true);
    expect(topBarLayout(1200, 0).envDropdown).toBe(false);
  });
});
