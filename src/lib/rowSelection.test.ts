import { describe, expect, it } from "vitest";
import { dropdownOptions, filterRows, fromRanges, matchingRuns, NO_FILTERS, rangeIndices, toRanges, type RowStatus } from "./rowSelection";

const rows = [
  { name: "Ada", plan: "Pro" },
  { name: "Grace", plan: "Free" },
  { name: "Linus", plan: "Pro" },
  { name: "ada2", plan: "Team" },
];
const statuses = new Map<number, RowStatus>([
  [0, "passed"],
  [1, "failed"],
]);

describe("filterRows", () => {
  it("returns every row with no filters", () => {
    expect(filterRows(rows, NO_FILTERS, new Set(), statuses)).toEqual([0, 1, 2, 3]);
  });
  it("matches text by contains, ignoring case", () => {
    expect(filterRows(rows, { columns: { name: "ADA" }, last: "" }, new Set(), statuses)).toEqual([0, 3]);
  });
  it("matches dropdown columns exactly", () => {
    expect(filterRows(rows, { columns: { plan: "Pro" }, last: "" }, new Set(["plan"]), statuses)).toEqual([0, 2]);
  });
  it("filters by last run, treating unrecorded rows as not run", () => {
    expect(filterRows(rows, { columns: {}, last: "none" }, new Set(), statuses)).toEqual([2, 3]);
    expect(filterRows(rows, { columns: {}, last: "failed" }, new Set(), statuses)).toEqual([1]);
  });
  it("combines filters", () => {
    expect(filterRows(rows, { columns: { plan: "Pro" }, last: "none" }, new Set(["plan"]), statuses)).toEqual([2]);
  });
});

describe("rangeIndices", () => {
  it("is 1-based and inclusive", () => expect(rangeIndices("2", "4", 10)).toEqual([1, 2, 3]));
  it("swaps a backwards range and clamps to the file", () => expect(rangeIndices("12", "0", 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  it("is empty for blanks and junk", () => {
    expect(rangeIndices("", "3", 10)).toEqual([]);
    expect(rangeIndices("a", "3", 10)).toEqual([]);
    expect(rangeIndices("15", "20", 10)).toEqual([]);
  });
});

describe("ranges", () => {
  it("round-trips a selection", () => {
    const sel = new Set([0, 1, 2, 7, 9, 10]);
    expect(toRanges(sel)).toEqual([[0, 2], [7, 7], [9, 10]]);
    expect([...fromRanges(toRanges(sel), 11)]).toEqual([0, 1, 2, 7, 9, 10]);
  });
  it("drops rows beyond the file", () => expect([...fromRanges([[3, 99]], 5)]).toEqual([3, 4]));
});

describe("dropdownOptions", () => {
  it("offers a dropdown only for few distinct values", () => {
    expect(dropdownOptions(rows, "plan")).toEqual(["Free", "Pro", "Team"]);
    expect(dropdownOptions(rows, "name", 2)).toBeNull();
  });
});

describe("matchingRuns", () => {
  const run = (csvName: string, requestId: string | undefined, startedAt: string, urlTemplate = "u") => ({ csvName, requestId, urlTemplate, startedAt });
  it("keeps this CSV and request, oldest first", () => {
    const got = matchingRuns([run("a.csv", "r1", "2"), run("b.csv", "r1", "1"), run("a.csv", "r2", "1"), run("a.csv", "r1", "0")], "a.csv", "r1", "u");
    expect(got.map((r) => r.startedAt)).toEqual(["0", "2"]);
  });
  it("falls back to the URL for runs saved without a request id", () => {
    expect(matchingRuns([run("a.csv", undefined, "1", "x"), run("a.csv", undefined, "2", "y")], "a.csv", "r1", "x")).toHaveLength(1);
  });
});
