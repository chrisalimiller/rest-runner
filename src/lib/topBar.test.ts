import { describe, expect, it } from "vitest";
import { modeForShortcut, nextModeIndex, topBarLayout } from "./topBar";

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

describe("modeForShortcut", () => {
  const press = (code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) =>
    modeForShortcut({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  it("maps Ctrl/Cmd + 1-3 to the sections", () => {
    expect(press("Digit1", { ctrlKey: true })).toBe("requests");
    expect(press("Digit2", { metaKey: true })).toBe("testing");
    expect(press("Digit3", { metaKey: true })).toBe("flows");
  });

  it("ignores Shift or Alt, a missing modifier, and other keys", () => {
    expect(press("Digit1", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press("Digit1", { ctrlKey: true, altKey: true })).toBeNull();
    expect(press("Digit2")).toBeNull();
    expect(press("Digit4", { ctrlKey: true })).toBeNull();
  });
});

describe("nextModeIndex", () => {
  it("wraps with the arrow keys", () => {
    expect(nextModeIndex(2, "ArrowRight")).toBe(0);
    expect(nextModeIndex(0, "ArrowLeft")).toBe(2);
    expect(nextModeIndex(0, "ArrowRight")).toBe(1);
  });

  it("jumps with Home and End, and ignores other keys", () => {
    expect(nextModeIndex(1, "Home")).toBe(0);
    expect(nextModeIndex(1, "End")).toBe(2);
    expect(nextModeIndex(1, "a")).toBeNull();
  });
});
