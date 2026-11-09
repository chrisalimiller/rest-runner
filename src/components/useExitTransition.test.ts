import { afterEach, describe, expect, it, vi } from "vitest";
import { playExit } from "./useExitTransition";

// The project runs vitest in a plain node environment, so the DOM is a small stand-in.
function fakeEl() {
  const attrs = new Map<string, string>();
  const el = {
    style: {} as Record<string, string>,
    isConnected: true,
    parentNode: null as null | { insertBefore: (n: unknown, ref: unknown) => void },
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
    removeAttribute: (k: string) => void attrs.delete(k),
    querySelectorAll: () => [] as unknown[],
    remove: vi.fn(() => {
      el.isConnected = false;
    }),
    cloneNode: () => el,
  };
  return el;
}

function setup(css: Record<string, string>) {
  const ghost = fakeEl();
  const node = fakeEl();
  node.cloneNode = () => ghost;
  const insertBefore = vi.fn();
  node.parentNode = { insertBefore };
  vi.stubGlobal("getComputedStyle", () => css);
  return { node: node as unknown as HTMLElement, ghost, insertBefore };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("playExit", () => {
  it("leaves nothing behind when no exit animation is defined", () => {
    const { node, ghost } = setup({ animationDuration: "", animationDelay: "" });
    expect(playExit(node)).toBeNull();
    expect(ghost.remove).toHaveBeenCalled();
  });

  it("leaves an inert closing copy in place for the animation duration, then removes it", () => {
    vi.useFakeTimers();
    const { node, ghost, insertBefore } = setup({ animationDuration: "0.1s", animationDelay: "0s" });
    ghost.setAttribute("id", "x");
    expect(playExit(node)).toBe(ghost);
    expect(ghost.getAttribute("data-state")).toBe("closing");
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.hasAttribute("id")).toBe(false);
    expect(ghost.style.pointerEvents).toBe("none");
    expect(insertBefore).toHaveBeenCalledWith(ghost, node);
    expect(ghost.remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(ghost.remove).toHaveBeenCalled();
  });

  it("reads millisecond durations and does nothing for a detached node", () => {
    vi.useFakeTimers();
    const { node, ghost } = setup({ animationDuration: "100ms, 0s", animationDelay: "0s" });
    expect(playExit(node)).toBe(ghost);
    const detached = fakeEl();
    expect(playExit(detached as unknown as HTMLElement)).toBeNull();
  });
});
