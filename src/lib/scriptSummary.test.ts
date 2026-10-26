import { describe, expect, it } from "vitest";
import { summarizeScripts, testsBadge } from "./scriptSummary";
import type { ScriptOutput } from "./testing/types";

const out = (p: Partial<ScriptOutput>): ScriptOutput => ({ tests: [], logs: [], vars: {}, durationMs: 1, ...p });

describe("summarizeScripts", () => {
  it("orders tests by script and counts them", () => {
    const s = summarizeScripts({
      pre: out({ tests: [{ name: "has token", passed: true }] }),
      post: out({ tests: [{ name: "200", passed: true }, { name: "id set", passed: false, error: "missing" }], vars: { id: "7" }, logs: ["done"] }),
    });
    expect(s.tests.map((t) => `${t.phase}:${t.name}`)).toEqual(["Pre-request:has token", "Post-response:200", "Post-response:id set"]);
    expect([s.passed, s.total, s.failed]).toEqual([2, 3, true]);
    expect(s.vars).toEqual({ id: "7" });
    expect(s.logs).toEqual([{ phase: "Post-response", lines: ["done"] }]);
  });

  it("treats a script error as failed even without tests", () => {
    const s = summarizeScripts({ post: out({ error: "boom" }) });
    expect(s.failed).toBe(true);
    expect(s.errors).toEqual([{ phase: "Post-response", error: "boom" }]);
  });

  it("gives a badge only when there are tests", () => {
    expect(testsBadge(null)).toBeNull();
    expect(testsBadge({ post: out({ tests: [{ name: "a", passed: true }] }) })).toBe("Tests 1/1");
  });
});
