import { describe, expect, it } from "vitest";
import { parseRecords } from "./csv";
import { csvFile } from "./reportCsv";

describe("spreadsheet-safe CSV boundary", () => {
  it("guards text in every position and preserves typed numbers and harmless text", () => {
    const values = ["=1+1", "+1+2", "-1+2", "@x", "\t=1", "\r=x", "\n=x", "  =x", '=1,"x"\nnext', "hello\nworld", -12, 2];
    const row = parseRecords(csvFile([values]).slice(1).trimEnd(), ",")[0];
    expect(row).toEqual(values.map((v, i) => i < 9 ? `'${v}` : String(v)));
  });
  it("masks before guarding, including headings", () => {
    const rows = parseRecords(csvFile([["secret=1", "=heading"], ["secret+1+2", "ordinary"]], { secrets: ["secret"] }).slice(1).trimEnd(), ",");
    expect(rows).toEqual([["••••••=1", "'=heading"], ["••••••+1+2", "ordinary"]]);
  });
});
