import { describe, expect, it } from "vitest";
import { parseRecords } from "./csv";
import { CALL_COLUMNS, callCells, csvCell, csvFile, emptyCallCells } from "./reportCsv";
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
