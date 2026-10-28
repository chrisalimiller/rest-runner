import { describe, expect, it } from "vitest";
import { iterationsLabel } from "./testRun";
import type { CaseResult } from "./types";

const at = (iteration: number) => ({ iteration }) as CaseResult;

describe("iterationsLabel", () => {
  it("shows how many iterations ran when a run stopped early", () => {
    expect(iterationsLabel({ iterations: 3, results: [at(0)] })).toBe("1 of 3");
    expect(iterationsLabel({ iterations: 2, results: [at(0), at(0), at(1)] })).toBe("2");
  });
});
