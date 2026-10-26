import { describe, expect, it } from "vitest";
import { DEFAULT_BATCH_OPTIONS } from "./batch";
import { parseRecords } from "./csv";
import { newRequest } from "./defaults";
import { reportFileName, toCsvReport, toHtmlReport } from "./report";
import { buildRun } from "./run";
import type { SendOutcome } from "./types";

const outcome = (status: number, body: string): SendOutcome => ({
  ok: true,
  request: { method: "POST", url: "https://a.test/u/1", headers: [["Content-Type", "application/json"]], body: '{"note":"say \\"hi\\", ok"}' },
  sentAt: "2026-10-22T10:00:00.000Z",
  response: { status, statusText: "OK", headers: [["content-type", "application/json"]], body, sizeBytes: body.length, durationMs: 12 },
});

const run = buildRun({
  id: "r1",
  request: { ...newRequest(), name: "Create: user/<test>", url: "https://a.test/u/{{id}}" },
  csvName: "users.csv",
  columns: ["id", "note"],
  totalRows: 2,
  options: DEFAULT_BATCH_OPTIONS,
  startedAt: "2026-10-22T10:00:00.000Z",
  finishedAt: "2026-10-22T10:00:01.000Z",
  end: "completed",
  results: [
    { index: 0, vars: { id: "1", note: 'line1\nline2, "quoted"' }, outcome: outcome(200, '{"ok":true}'), failed: false },
    { index: 1, vars: { id: "2", note: "<script>alert(1)</script>" }, outcome: outcome(500, "<b>boom</b>"), failed: true },
  ],
  missingPlaceholders: [],
});

describe("toCsvReport", () => {
  it("round-trips through a CSV parser with every field intact", () => {
    const csv = toCsvReport(run);
    expect(csv.startsWith("﻿")).toBe(true);
    const records = parseRecords(csv.slice(1).trimEnd(), ",");
    const [head, first, second] = records;
    expect(head.slice(0, 3)).toEqual(["row", "result", "status"]);
    expect(head.slice(-2)).toEqual(["var:id", "var:note"]);
    const col = (name: string) => head.indexOf(name);
    expect(first[col("result")]).toBe("PASS");
    expect(first[col("request_body")]).toBe('{"note":"say \\"hi\\", ok"}');
    expect(first[col("request_headers")]).toBe("Content-Type: application/json");
    expect(first[col("var:note")]).toBe('line1\nline2, "quoted"');
    expect(second[col("result")]).toBe("FAIL");
    expect(second[col("status")]).toBe("500");
    expect(second[col("notes")]).toMatch(/HTTP 500 counted as a failure/);
    expect(records).toHaveLength(3);
  });
});

describe("toHtmlReport", () => {
  const html = toHtmlReport(run);
  it("escapes all user content", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<b>boom</b>");
    expect(html).toContain("Create: user/&lt;test&gt;");
  });
  it("includes summary, log, notes and every call", () => {
    expect(html.match(/<details class="call/g)).toHaveLength(2);
    expect(html).toContain("Run log");
    expect(html).toContain("HTTP 500 counted as a failure.");
    expect(html).toContain("&quot;ok&quot;: true");
  });
});

describe("reportFileName", () => {
  it("removes characters that are not allowed in file names", () => {
    expect(reportFileName(run, "html")).toMatch(/^Create user test \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.html$/);
    expect(reportFileName(run, "csv")).not.toMatch(/[\\/:*?"|]/);
  });
});

describe("certificate in reports", () => {
  const withCert = {
    ...run,
    entries: run.entries.map((e, i) => (i === 0 ? { ...e, outcome: { ...e.outcome, certificate: { id: "c", name: "Acme <staging>", sha256: "ab12cd34".repeat(8) } } } : e)),
  };

  it("adds a certificate column to the CSV, empty for calls without one", () => {
    const [head, first, second] = parseRecords(toCsvReport(withCert).slice(1).trimEnd(), ",");
    const col = head.indexOf("certificate");
    expect(first[col]).toBe("Acme <staging> (ab12cd34)");
    expect(second[col]).toBe("");
  });

  it("names the certificate in the HTML, escaped", () => {
    expect(toHtmlReport(withCert)).toContain("Certificate: Acme &lt;staging&gt; (ab12cd34)");
    expect(toHtmlReport(run)).not.toContain("Certificate:");
  });
});
