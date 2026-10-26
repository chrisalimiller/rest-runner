import { describe, expect, it } from "vitest";
import { findJsonProblem, formatJson, stripJsonComments } from "./jsonFormat";

describe("findJsonProblem", () => {
  it("accepts valid JSON and placeholders as values or keys", () => {
    for (const ok of ['{"a":1}', "[1, 2.5e3, -0, true, null]", '"x"', "{}", "[]", '{"id": {{id}}, "n": "{{name}}"}', '{ {{key}}: 1 }', "{{whole}}", "  ", '"a\\"b\\\\"'])
      expect(findJsonProblem(ok), ok).toBeNull();
  });

  it("reports problems with a position", () => {
    const cases: [string, RegExp, number][] = [
      ['{"a":1,}', /Trailing comma/, 7],
      ["{a:1}", /Unexpected "a"/, 1],
      ['{"a" 1}', /Expected :/, 5],
      ['{"a":1 "b":2}', /Expected , or \}/, 7],
      ['[1,2', /Expected , or \]/, 3],
      ['{"a":"x', /closing quote/, 5],
      ["{'a':1}", /Unexpected "'a'"/, 1],
      ['{"a":1}x', /Unexpected "x"/, 7],
      ['{"a":1} {}', /after the end/, 8],
    ];
    for (const [text, msg, from] of cases) {
      const p = findJsonProblem(text);
      expect(p?.message, text).toMatch(msg);
      expect(p?.from, text).toBe(from);
    }
  });
});

describe("formatJson", () => {
  it("indents with two spaces and keeps strings, numbers and placeholders exactly", () => {
    const input = '{"id":{{id}},"name":"{{ name }}","tags":["a, b",1e3],"empty":{},"none":[],"q":"say \\"hi\\""}';
    expect(formatJson(input)).toBe(
      [
        "{",
        '  "id": {{id}},',
        '  "name": "{{ name }}",',
        '  "tags": [',
        '    "a, b",',
        "    1e3",
        "  ],",
        '  "empty": {},',
        '  "none": [],',
        '  "q": "say \\"hi\\""',
        "}",
      ].join("\n"),
    );
  });

  it("matches JSON.stringify for plain JSON", () => {
    const obj = { a: [1, { b: null, c: [true, false] }], d: "x\ny" };
    expect(formatJson(JSON.stringify(obj))).toBe(JSON.stringify(obj, null, 2));
  });

  it("returns null for invalid or blank input", () => {
    expect(formatJson('{"a":}')).toBeNull();
    expect(formatJson("")).toBeNull();
  });
});

describe("comments in JSON", () => {
  const text = '{\n  // the id\n  "id": 1, /* inline */\n  "url": "http://x//y", "q": "/* not a comment */"\n}';

  it("accepts // and block comments", () => {
    expect(findJsonProblem(text)).toBeNull();
  });

  it("still rejects trailing commas", () => {
    expect(findJsonProblem('{"a": 1, // c\n}')?.message).toMatch(/Trailing comma/);
  });

  it("reports an unterminated block comment", () => {
    expect(findJsonProblem('{"a": 1 /* oops')?.message).toMatch(/closing/);
  });

  it("strips comments but not text inside strings", () => {
    const stripped = stripJsonComments(text);
    expect(JSON.parse(stripped)).toEqual({ id: 1, url: "http://x//y", q: "/* not a comment */" });
  });

  it("returns text without comments unchanged and does not format text with comments", () => {
    expect(stripJsonComments('{"a": 1}')).toBe('{"a": 1}');
    expect(formatJson(text)).toBeNull();
  });
});
