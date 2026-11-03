import { describe, expect, it } from "vitest";
import { parseRecords } from "./csv";
import { CALL_COLUMNS, callCells, csvCell, csvFile, emptyCallCells, guardFormula } from "./reportCsv";
import type { SendOutcome } from "./types";

const ok = (body: string): SendOutcome => ({
  ok: true,
  request: { method: "POST", url: "https://a.test/x", headers: [["A", "1"], ["B", "2"]], body: '{"a":\n\n"x, \\"y\\""}' },
  sentAt: "2026-11-03T00:00:00.000Z",
  response: { status: 201, statusText: "Created", headers: [["content-type", "application/json"]], body, sizeBytes: body.length, durationMs: 7 },
});

describe("callCells", () => {
  it("has one cell per call column", () => {
    expect(callCells(ok("{}"))).toHaveLength(CALL_COLUMNS.length);
    expect(callCells(null)).toHaveLength(CALL_COLUMNS.length);
    expect(emptyCallCells()).toHaveLength(CALL_COLUMNS.length);
  });

  it("describes a response", () => {
    const cells = callCells(ok("hi"));
    const at = (c: (typeof CALL_COLUMNS)[number]) => cells[CALL_COLUMNS.indexOf(c)];
    expect(at("status")).toBe("201");
    expect(at("status_text")).toBe("Created");
    expect(at("request_headers")).toBe("A: 1\nB: 2");
    expect(at("response_size_bytes")).toBe(2);
    expect(at("error")).toBe("");
  });

  it("fills final_url only after a redirect", () => {
    const col = CALL_COLUMNS.indexOf("final_url");
    expect(callCells(ok("x"))[col]).toBe("");
    expect(callCells({ ...ok("x"), finalUrl: "https://b.test/" } as SendOutcome)[col]).toBe("https://b.test/");
  });

  it("describes a failed send and a call that never ran", () => {
    const failed: SendOutcome = { ok: false, request: { method: "GET", url: "u", headers: [] }, error: "timeout", durationMs: 5, sentAt: "t" };
    const c = callCells(failed);
    expect(c[0]).toBe("Error");
    expect(c[CALL_COLUMNS.indexOf("error")]).toBe("timeout");
    expect(c[CALL_COLUMNS.indexOf("response_body")]).toBe("");
    expect(callCells(undefined)[0]).toBe("Not sent");
  });

  it("round-trips commas, quotes and blank lines through parseRecords", () => {
    const body = 'line1, "two"\n\n\nline4\r\nlast';
    const csv = csvFile([[...CALL_COLUMNS], callCells(ok(body))]);
    const [, row] = parseRecords(csv.slice(1).trimEnd(), ",");
    expect(row[CALL_COLUMNS.indexOf("response_body")]).toBe(body);
    expect(row[CALL_COLUMNS.indexOf("request_body")]).toBe('{"a":\n\n"x, \\"y\\""}');
  });
});

describe("csvCell", () => {
  it("quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell(" x")).toBe('" x"');
  });
});

describe("Excel safety", () => {
  const cell = (o: SendOutcome, col: (typeof CALL_COLUMNS)[number], opts = {}) => callCells(o, opts)[CALL_COLUMNS.indexOf(col)];
  const withBody = (body: string, headers: [string, string][] = [["content-type", "text/plain"]], size = body.length): SendOutcome => ({
    ok: true,
    request: { method: "GET", url: "https://a.test/", headers: [] },
    sentAt: "t",
    response: { status: 200, statusText: "OK", headers, body, sizeBytes: size, durationMs: 1 },
  });

  it("cuts a long body at 32,000 characters and says how much was left", () => {
    const out = String(cell(withBody("x".repeat(80000)), "response_body"));
    expect(out.startsWith("x".repeat(32000) + "…")).toBe(true);
    expect(out).toContain("[cut: 48,000 more characters; the full body is in the HTML report]");
    expect(out.length).toBeLessThan(32767);
    expect(cell(withBody("y".repeat(32000)), "response_body")).toBe("y".repeat(32000));
  });

  it("does not split a surrogate pair when cutting", () => {
    const body = "a".repeat(31999) + "😀" + "b".repeat(10);
    const out = String(cell(withBody(body), "response_body"));
    expect(out).not.toMatch(/[\ud800-\udbff]…/);
  });

  it("replaces a binary body with a note", () => {
    expect(cell(withBody("��PNG", [["Content-Type", "image/png"]], 12345), "response_body")).toBe("(binary body: 12,345 bytes, image/png)");
    expect(cell(withBody("ab\0cd", []), "response_body")).toBe("(binary body: 5 bytes)");
    expect(cell(withBody('{"a":1}', [["content-type", "application/json; charset=utf-8"]]), "response_body")).toBe('{"a":1}');
    expect(cell(withBody("<svg/>", [["content-type", "image/svg+xml"]]), "response_body")).toBe("<svg/>");
  });

  it("stops formulas, but leaves numbers alone", () => {
    expect(cell(withBody("=1+1"), "response_body")).toBe("'=1+1");
    expect(cell(withBody("@SUM(A1)"), "response_body")).toBe("'@SUM(A1)");
    expect(cell(withBody("-cmd|' /C calc'!A0"), "response_body")).toBe("'-cmd|' /C calc'!A0");
    expect(cell(withBody("+x"), "response_body")).toBe("'+x");
    expect(cell(withBody("-1"), "response_body")).toBe("-1");
    expect(cell(withBody("+12.5"), "response_body")).toBe("+12.5");
    expect(cell(withBody("hello =1"), "response_body")).toBe("hello =1");
    expect(guardFormula("-")).toBe("'-");
  });

  it("guards header, URL and error cells too", () => {
    const failed: SendOutcome = { ok: false, request: { method: "GET", url: "=HYPERLINK()", headers: [], body: "@x" }, error: "+bad", durationMs: 1, sentAt: "t" };
    expect(cell(failed, "url")).toBe("'=HYPERLINK()");
    expect(cell(failed, "request_body")).toBe("'@x");
    expect(cell(failed, "error")).toBe("'+bad");
  });

  it("masks secrets before cutting, so a secret at the cut is not left half showing", () => {
    const secret = "S3CR3T-VALUE-THAT-IS-LONG";
    const body = "x".repeat(31990) + secret + "tail";
    const out = String(cell(withBody(body), "response_body", { secrets: [secret] }));
    expect(out).not.toContain("S3CR3T");
    expect(out).toContain("••••••");
    expect(String(cell(withBody(`token ${secret}`), "response_body", { secrets: [secret] }))).toBe("token ••••••");
  });
});
