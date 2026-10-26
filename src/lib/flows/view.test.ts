import { describe, expect, it } from "vitest";
import { chooseView, fitZoom } from "./view";

const view = { width: 1000, height: 600 };

describe("chooseView", () => {
  it("fits a small flow", () => {
    const bounds = { x: 0, y: 0, width: 800, height: 300 };
    expect(fitZoom(bounds, view)).toBeGreaterThan(0.7);
    expect(chooseView(bounds, view, { x: 0, y: 0, width: 220, height: 80 })).toEqual({ kind: "fit" });
  });

  it("opens a big flow at zoom 1 centred on Start", () => {
    const bounds = { x: 0, y: 0, width: 3000, height: 1200 };
    expect(fitZoom(bounds, view)).toBeLessThan(0.7);
    expect(chooseView(bounds, view, { x: 100, y: 200, width: 220, height: 80 })).toEqual({ kind: "centre", x: 210, y: 240, zoom: 1 });
  });

  it("centres on the flow itself when there is no Start", () => {
    expect(chooseView({ x: 0, y: 0, width: 4000, height: 2000 }, view, null)).toEqual({ kind: "centre", x: 2000, y: 1000, zoom: 1 });
  });

  it("fits at exactly the readable limit", () => {
    // usable width 700 / bounds 1000 = 0.7
    expect(chooseView({ x: 0, y: 0, width: 1000, height: 100 }, view, null)).toEqual({ kind: "fit" });
  });
});
