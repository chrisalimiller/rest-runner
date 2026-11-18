import { describe, expect, it } from "vitest";
import { importSuitesFile, toSuitesFile } from "./suiteFile";
import { cleanSuites, newSuite, newTestCase } from "./suites";

function rawSuite(caseExtra: Record<string, unknown> = {}) {
  const tc = newTestCase();
  return { ...newSuite("S"), cases: [{ ...tc, ...caseExtra }] };
}

describe("cleanSuites with setup and retry", () => {
  it("loads a case without the new fields exactly as before", () => {
    const [s] = cleanSuites([rawSuite()]);
    expect("runs" in s.cases[0]).toBe(false);
    expect("retry" in s.cases[0]).toBe(false);
  });

  it("keeps runs and retry, and drops bad values", () => {
    const [s] = cleanSuites([rawSuite({ runs: "before", retry: { times: 3, delayMs: 250 } })]);
    expect(s.cases[0].runs).toBe("before");
    expect(s.cases[0].retry).toEqual({ times: 3, delayMs: 250 });
    const [bad] = cleanSuites([rawSuite({ runs: "sometimes", retry: { times: "x" } })]);
    expect("runs" in bad.cases[0]).toBe(false);
    expect("retry" in bad.cases[0]).toBe(false);
    const [capped] = cleanSuites([rawSuite({ retry: { times: 5000, delayMs: -4 } })]);
    expect(capped.cases[0].retry).toEqual({ times: 100, delayMs: 0 });
  });

  it("survives the suite export file round trip", () => {
    const [s] = cleanSuites([rawSuite({ runs: "after", retry: { times: 1, delayMs: 10 } })]);
    const text = toSuitesFile([s]);
    const parsed = JSON.parse(text);
    expect(parsed.suites[0].cases[0].runs).toBe("after");
    const imported = importSuitesFile(text, []);
    expect(imported.suites[0].cases[0].runs).toBe("after");
    expect(imported.suites[0].cases[0].retry).toEqual({ times: 1, delayMs: 10 });
  });
});
