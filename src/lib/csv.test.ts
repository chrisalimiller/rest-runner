import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple file", () => {
    const d = parseCsv("id,name\n1,Ann\n2,Bob\n");
    expect(d.headers).toEqual(["id", "name"]);
    expect(d.rows).toEqual([
      { id: "1", name: "Ann" },
      { id: "2", name: "Bob" },
    ]);
    expect(d.warnings).toEqual([]);
  });

  it("handles quotes, escaped quotes, delimiters and newlines inside quotes, CRLF and BOM", () => {
    const d = parseCsv('﻿id,note\r\n1,"a, b"\r\n2,"say ""hi"""\r\n3,"line1\nline2"\r\n');
    expect(d.rows.map((r) => r.note)).toEqual(["a, b", 'say "hi"', "line1\nline2"]);
    expect(d.headers).toEqual(["id", "note"]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2").rows).toEqual([{ a: "1", b: "2" }]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("keeps empty values and skips blank lines", () => {
    const d = parseCsv("a,b\n1,\n\n,2\n");
    expect(d.rows).toEqual([
      { a: "1", b: "" },
      { a: "", b: "2" },
    ]);
  });

  it("warns on ragged rows and duplicate or blank headers", () => {
    const d = parseCsv("a,a,\n1,2,3,4\n5\n");
    expect(d.headers).toEqual(["a", "a_2", "column3"]);
    expect(d.rows[1]).toEqual({ a: "5", a_2: "", column3: "" });
    expect(d.warnings).toHaveLength(2);
  });

  it("handles an empty file", () => {
    expect(parseCsv("").rows).toEqual([]);
  });
});
