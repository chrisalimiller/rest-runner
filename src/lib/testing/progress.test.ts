import { describe, expect, it } from "vitest";
import { caseTally, runningLabel } from "./progress";
import type { CaseResult } from "./types";

const r = (caseId: string, iteration: number, passed: boolean) => ({ caseId, iteration, passed }) as CaseResult;

describe("caseTally", () => {
  it("counts passed and failed per case", () => {
    const results = [r("a", 0, true), r("a", 1, false), r("b", 0, true), r("a", 2, true)];
    expect(caseTally(results, "a")).toEqual({ passed: 2, failed: 1 });
    expect(caseTally(results, "c")).toEqual({ passed: 0, failed: 0 });
  });
});

describe("runningLabel", () => {
  it("names the iteration when there are several", () => {
    expect(runningLabel([r("a", 0, true), r("a", 2, true)], 12, 24)).toBe("Running · iteration 3 of 12");
    expect(runningLabel([], 12, 24)).toBe("Running · iteration 1 of 12");
  });
  it("counts cases for a single pass", () => {
    expect(runningLabel([r("a", 0, true)], 1, 4)).toBe("Running · 1 of 4");
  });
});
