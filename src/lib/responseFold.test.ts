import { describe, expect, it } from "vitest";
import { nextResponseHidden, unfoldedRequestWidth } from "./responseFold";

describe("nextResponseHidden", () => {
  it("hides the response when the tab row needs more than it has", () => {
    expect(nextResponseHidden(false, 700, 560, 560)).toBe(true);
    expect(nextResponseHidden(false, 560, 560, 560)).toBe(false);
  });
  it("keeps it hidden until the request column would fit with the response back", () => {
    expect(nextResponseHidden(true, 700, 1000, 650)).toBe(true);
    expect(nextResponseHidden(true, 700, 1000, 700)).toBe(false);
  });
});

describe("unfoldedRequestWidth", () => {
  it("follows the split within the column minimums", () => {
    expect(unfoldedRequestWidth(1200, 0.55, 380)).toBe(660);
    expect(unfoldedRequestWidth(1200, 0.2, 380)).toBe(380);
    expect(unfoldedRequestWidth(1200, 0.9, 380)).toBe(819);
  });
});
