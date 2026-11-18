import { describe, expect, it } from "vitest";
import { clampRepeat, MAX_REPEAT, plannedCases, planEstimate, splitCases } from "./plan";
import type { TestCase } from "./types";

describe("planEstimate", () => {
  it("multiplies rows, cases and repeats", () => {
    expect(planEstimate(12, 3, 1)).toEqual({ total: 36, text: "36 cases planned (12 rows × 3 cases × 1 repeat)" });
    expect(planEstimate(2, 5, 3).text).toBe("30 cases planned (2 rows × 5 cases × 3 repeats)");
  });

  it("leaves out rows when there is no CSV", () => {
    expect(planEstimate(null, 4, 2).text).toBe("8 cases planned (4 cases × 2 repeats)");
    expect(planEstimate(0, 1, 1).text).toBe("1 case planned (1 case × 1 repeat)");
  });

  it("is zero when no case is on", () => {
    expect(planEstimate(5, 0, 1).total).toBe(0);
  });
});

describe("clampRepeat", () => {
  it("keeps repeats between 1 and MAX_REPEAT", () => {
    expect([clampRepeat(5000), clampRepeat(0), clampRepeat("12"), clampRepeat("x"), clampRepeat(2.7)]).toEqual([MAX_REPEAT, 1, 12, 1, 2]);
  });
});

describe("setup and teardown in the plan", () => {
  it("counts setup and teardown once, not once per row or repeat", () => {
    expect(planEstimate(4, 1, 1, 1).text).toBe("5 cases planned (1 setup + 4 rows × 1 case × 1 repeat)");
    expect(planEstimate(2, 3, 2, 1, 1)).toEqual({ total: 14, text: "14 cases planned (1 setup + 1 teardown + 2 rows × 3 cases × 2 repeats)" });
  });

  it("plannedCases and splitCases group by when a case runs and ignore disabled ones", () => {
    const c = (runs?: "before" | "after", enabled = true) => ({ id: Math.random().toString(), enabled, ...(runs ? { runs } : {}) }) as unknown as TestCase;
    const cases = [c("after"), c(), c("before"), c(undefined, false), c("before", false)];
    expect(plannedCases(cases, 3)).toBe(1 + 1 + 3);
    const s = splitCases(cases);
    expect([s.before.length, s.each.length, s.after.length]).toEqual([2, 2, 1]);
    expect(s.before.map((x) => x.caseIndex)).toEqual([2, 4]);
  });
});
