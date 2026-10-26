import { describe, expect, it } from "vitest";
import { planEstimate } from "./plan";

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
