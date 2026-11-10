import { describe, expect, it } from "vitest";
import { moveIndex, typeAheadIndex } from "./listbox";

const M = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

describe("moveIndex", () => {
  it("moves and clamps", () => {
    expect(moveIndex(0, "ArrowDown", 7)).toBe(1);
    expect(moveIndex(6, "ArrowDown", 7)).toBe(6);
    expect(moveIndex(0, "ArrowUp", 7)).toBe(0);
    expect(moveIndex(3, "Home", 7)).toBe(0);
    expect(moveIndex(3, "End", 7)).toBe(6);
  });
  it("ignores other keys and empty lists", () => {
    expect(moveIndex(0, "a", 7)).toBeNull();
    expect(moveIndex(0, "ArrowDown", 0)).toBeNull();
  });
});

describe("typeAheadIndex", () => {
  it("finds by prefix", () => {
    expect(typeAheadIndex(M, 0, "d")).toBe(4);
    expect(typeAheadIndex(M, 0, "pa")).toBe(3);
    expect(typeAheadIndex(M, 0, "x")).toBe(-1);
  });
  it("cycles on a repeated letter", () => {
    expect(typeAheadIndex(M, 1, "p")).toBe(2);
    expect(typeAheadIndex(M, 2, "p")).toBe(3);
    expect(typeAheadIndex(M, 3, "pp")).toBe(1);
  });
  it("keeps the current option while the prefix still matches", () => {
    expect(typeAheadIndex(M, 3, "pa")).toBe(3);
  });
});
