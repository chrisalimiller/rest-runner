import { describe, expect, it } from "vitest";
import { checkCsvFile, parseCsv } from "./csv";

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

describe("checkCsvFile", () => {
  it("accepts csv, tsv, semicolon and one-column files", () => {
    expect(checkCsvFile("a.csv", "id,name\n1,Ann\n")).toBeNull();
    expect(checkCsvFile("A.TSV", "id\tname\n1\tAnn\n")).toBeNull();
    expect(checkCsvFile("a.txt", "id;name\n1;Ann\n")).toBeNull();
    expect(checkCsvFile("a.csv", "id\n1\n2\n")).toBeNull();
  });
  it("rejects a wrong extension", () => {
    expect(checkCsvFile("photo.png", "id,name\n1,Ann")).toMatch(/isn't a CSV file/);
  });
  it("rejects binary content", () => {
    expect(checkCsvFile("a.csv", "\u0089PNG\r\n\u001a\n\u0000\u0000\u0000IHDR")).toMatch(/binary/);
    expect(checkCsvFile("a.csv", "\ufffd".repeat(50) + "id,name")).toMatch(/binary/);
  });
  it("rejects JSON and XML", () => {
    expect(checkCsvFile("a.csv", '{"a":1}')).toMatch(/JSON/);
    expect(checkCsvFile("a.csv", '[{"a":1}]')).toMatch(/JSON/);
    expect(checkCsvFile("a.csv", "<?xml version='1.0'?><a/>")).toMatch(/XML or HTML/);
  });
  it("rejects mostly ragged rows but allows a few", () => {
    expect(checkCsvFile("a.csv", "a,b,c\n1\n2\n3,4,5\n")).toMatch(/Most rows don't match the header's 3 columns/);
    expect(checkCsvFile("a.csv", "a,b,c\n1,2,3\n4,5,6\n7\n")).toBeNull();
  });
});
