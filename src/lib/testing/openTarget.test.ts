import { describe, expect, it } from "vitest";
import { newSuite, newTestCase } from "./suites";
import { resolveOpenTarget } from "./openTarget";

describe("resolveOpenTarget", () => {
  const suite = { ...newSuite("S"), cases: [newTestCase(), newTestCase()] };
  it("opens the suite", () => {
    expect(resolveOpenTarget([suite], suite.id)).toEqual({ ok: true, suiteId: suite.id, caseId: null, notice: null });
  });
  it("opens the case", () => {
    const id = suite.cases[1].id;
    expect(resolveOpenTarget([suite], suite.id, id)).toEqual({ ok: true, suiteId: suite.id, caseId: id, notice: null });
  });
  it("opens the suite with a notice when the case is gone", () => {
    expect(resolveOpenTarget([suite], suite.id, "gone")).toMatchObject({ ok: true, caseId: null, notice: "That case no longer exists." });
  });
  it("says so when the suite is gone", () => {
    expect(resolveOpenTarget([suite], "gone")).toEqual({ ok: false, notice: "That suite no longer exists." });
  });
});
