import { describe, expect, it } from "vitest";
import { buildGrid } from "./grid";
import type { CaseResult } from "./types";

function result(iteration: number, caseIndex: number, passed: boolean, status: number | null, first = "x"): CaseResult {
  return {
    iteration,
    rowIndex: iteration,
    repeatIndex: 0,
    caseId: `c${caseIndex}`,
    caseName: `Case ${caseIndex + 1}`,
    caseIndex,
    vars: { name: `${first}${iteration}` },
    outcome:
      status === null
        ? undefined
        : ({ ok: true, response: { status }, request: { url: "u" } } as unknown as CaseResult["outcome"]),
    checks: [],
    passed,
    notes: [],
    startedAt: "",
    durationMs: 1,
  };
}

describe("buildGrid", () => {
  const results = [result(0, 0, true, 200), result(0, 1, true, 201), result(1, 0, true, 200), result(1, 1, false, 500), result(2, 0, true, 200)];

  it("makes one column per case and one row per iteration, failures first", () => {
    const g = buildGrid({ results });
    expect(g.columns.map((c) => c.caseName)).toEqual(["Case 1", "Case 2"]);
    expect(g.rows.map((r) => r.iteration)).toEqual([1, 0, 2]);
    expect(g.rows[0].cells.map((c) => c?.label)).toEqual(["200", "500"]);
    expect(g.rows[0].cells[1]).toMatchObject({ passed: false, resultIndex: 3 });
  });

  it("leaves a cell empty when a case never ran, and keeps order when asked", () => {
    const g = buildGrid({ results }, false);
    expect(g.rows.map((r) => r.iteration)).toEqual([0, 1, 2]);
    expect(g.rows[2].cells[1]).toBeNull();
    expect(g.rows[0].title).toBe("Row 1 · x0");
  });

  it("labels a missing outcome", () => {
    expect(buildGrid({ results: [result(0, 0, false, null)] }).rows[0].cells[0]?.label).toBe("—");
  });
});
