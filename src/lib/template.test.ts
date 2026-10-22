import { describe, expect, it } from "vitest";
import { applyJsonTemplate, applyTemplate, findPlaceholders } from "./template";

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

describe("applyJsonTemplate", () => {
  it("escapes values inside JSON strings", () => {
    const out = applyJsonTemplate('{"note":"{{note}}","tag":"x-{{ id }}"}', { note: 'say "hi"\\ \nnext', id: "7" });
    expect(JSON.parse(out)).toEqual({ note: 'say "hi"\\ \nnext', tag: "x-7" });
  });

  it("inserts raw values outside strings", () => {
    const out = applyJsonTemplate('{"age": {{age}}, "ok": {{ok}}, "tags": {{tags}}}', { age: "42", ok: "true", tags: '["a","b"]' });
    expect(JSON.parse(out)).toEqual({ age: 42, ok: true, tags: ["a", "b"] });
  });

  it("is not fooled by escaped quotes and leaves unknown placeholders", () => {
    const out = applyJsonTemplate('{"a":"he said \\"{{x}}\\"","b":"{{missing}}"}', { x: '"q"' });
    expect(JSON.parse(out)).toEqual({ a: 'he said "\"q\""', b: "{{missing}}" });
  });
});
