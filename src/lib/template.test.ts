import { describe, expect, it } from "vitest";
import { applyTemplate, findPlaceholders } from "./template";

describe("applyTemplate", () => {
  it("replaces known names, trims spaces, and keeps unknown ones", () => {
    expect(applyTemplate("{{a}}-{{ b }}-{{c}}", { a: "1", b: "2" })).toBe("1-2-{{c}}");
  });

  it("allows empty values", () => {
    expect(applyTemplate("x{{a}}y", { a: "" })).toBe("xy");
  });

  it("lists placeholders", () => {
    expect(findPlaceholders("{{a}} {{b}} {{ a }}")).toEqual(["a", "b"]);
  });
});
