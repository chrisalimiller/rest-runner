import { describe, expect, it } from "vitest";
import { newCollection } from "./collections";
import { newFlow } from "./flows/flows";
import { isFirstRun } from "./workspaceStore";

const empty = { collections: [], environments: [], suites: [], flows: [] };

describe("isFirstRun", () => {
  it("is true only for an empty workspace that was not dealt with yet", () => {
    expect(isFirstRun(empty, false)).toBe(true);
    expect(isFirstRun(empty, true)).toBe(false);
    expect(isFirstRun({ ...empty, collections: [newCollection("A")] }, false)).toBe(false);
    expect(isFirstRun({ ...empty, flows: [newFlow()] }, false)).toBe(false);
  });
});
