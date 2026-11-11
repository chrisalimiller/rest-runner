import { afterEach, describe, expect, it, vi } from "vitest";
import { guardLeave, hasLeaveGuards, setLeaveGuard } from "./unsavedWork";

afterEach(() => setLeaveGuard("tools", null));

describe("guardLeave", () => {
  it("goes ahead when nothing is registered", () => {
    const go = vi.fn();
    guardLeave("tools", go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("goes ahead when the guard says so", () => {
    const go = vi.fn();
    setLeaveGuard("tools", () => true);
    guardLeave("tools", go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("waits when the guard asks, and goes on only when it calls proceed", () => {
    const go = vi.fn();
    let later: (() => void) | null = null;
    setLeaveGuard("tools", (proceed) => {
      later = proceed;
      return false;
    });
    guardLeave("tools", go);
    expect(go).not.toHaveBeenCalled();
    later!();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("only guards its own section and can be removed", () => {
    const go = vi.fn();
    setLeaveGuard("tools", () => false);
    expect(hasLeaveGuards()).toBe(true);
    guardLeave("flows", go);
    expect(go).toHaveBeenCalledTimes(1);
    setLeaveGuard("tools", null);
    expect(hasLeaveGuards()).toBe(false);
  });
});
