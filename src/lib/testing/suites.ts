import { newRequest } from "../defaults";
import { newId } from "../ids";
import { clampRepeat } from "./plan";
import type { RequestDef } from "../types";
import { ASSERTION_OPS, DEFAULT_SUITE_OPTIONS, type Assertion, type TestCase, type TestSuite } from "./types";

export function newAssertion(partial: Partial<Assertion> = {}): Assertion {
  return { id: newId(), enabled: true, source: "status", property: "", op: "eq", expected: "200", ...partial };
}

/** A new case. Given a request, the case gets its own copy and remembers where it came from. */
export function newTestCase(from?: RequestDef): TestCase {
  const request = from ? { ...structuredClone(from), id: newId() } : newRequest();
  return {
    id: newId(),
    name: from?.name ?? "New test case",
    enabled: true,
    request,
    sourceRequestId: from?.id,
    preScript: "",
    postScript: "",
    assertions: [newAssertion()],
  };
}

export function newSuite(name = "New test suite"): TestSuite {
  return { id: newId(), name, description: "", cases: [], options: { ...DEFAULT_SUITE_OPTIONS } };
}

/** A copy with fresh ids, for "Duplicate". */
export function duplicateCase(tc: TestCase): TestCase {
  return {
    ...structuredClone(tc),
    id: newId(),
    name: `${tc.name} copy`,
    request: { ...structuredClone(tc.request), id: newId() },
    assertions: tc.assertions.map((a) => ({ ...a, id: newId() })),
  };
}

/** Fills in anything missing from suites loaded from storage or an import, and drops what cannot be used. */
export function cleanSuites(input: unknown): TestSuite[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is TestSuite => !!s && typeof s === "object" && typeof s.id === "string" && Array.isArray(s.cases))
    .map((s) => ({
      id: s.id,
      name: typeof s.name === "string" ? s.name : "Test suite",
      description: typeof s.description === "string" ? s.description : "",
      options: { ...DEFAULT_SUITE_OPTIONS, ...(s.options ?? {}), repeat: clampRepeat(s.options?.repeat ?? DEFAULT_SUITE_OPTIONS.repeat) },
      data: s.data && typeof s.data.name === "string" && typeof s.data.text === "string" ? { name: s.data.name, text: s.data.text } : undefined,
      cases: s.cases
        .filter((c) => !!c && typeof c.id === "string" && !!c.request && typeof c.request.url === "string")
        .map((c) => ({
          id: c.id,
          name: typeof c.name === "string" ? c.name : "Test case",
          enabled: c.enabled !== false,
          request: { ...newRequest(), ...c.request },
          sourceRequestId: c.sourceRequestId,
          preScript: typeof c.preScript === "string" ? c.preScript : "",
          postScript: typeof c.postScript === "string" ? c.postScript : "",
          assertions: (Array.isArray(c.assertions) ? c.assertions : [])
            .filter((a) => !!a && ASSERTION_OPS.includes(a.op))
            .map((a) => ({ ...newAssertion(), ...a })),
        })),
    }));
}
