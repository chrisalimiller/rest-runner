import { describe, expect, it } from "vitest";
import { clampRepeat, MAX_REPEAT, planEstimate } from "./plan";

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
