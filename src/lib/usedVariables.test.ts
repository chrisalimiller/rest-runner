import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import type { FlowItems } from "./flows/items";
import { newFlow, newNode } from "./flows/flows";
import { newSuite } from "./testing/suites";
import type { Assertion, TestCase } from "./testing/types";
import { casePlaceholders, flowPlaceholders, suitePlaceholders } from "./usedVariables";

const assertion = (expected: string): Assertion => ({ id: "a", enabled: true, source: "body", property: "", op: "contains", expected });
const testCase = (url: string, expected: string[] = [], enabled = true): TestCase => ({
  id: url,
  name: url,
  enabled,
  request: { ...newRequest(), url },
  preScript: "",
  postScript: "",
  assertions: expected.map(assertion),
});

describe("casePlaceholders", () => {
  it("finds names in the request and in assertions", () => {
    expect(casePlaceholders(testCase("{{base}}/x", ["{{name}}", "{{base}}"]))).toEqual(["base", "name"]);
  });
});

describe("suitePlaceholders", () => {
  it("skips disabled cases", () => {
    const suite = { ...newSuite(), cases: [testCase("{{a}}"), testCase("{{b}}", [], false)] };
    expect(suitePlaceholders(suite)).toEqual(["a"]);
  });
});

describe("flowPlaceholders", () => {
  it("reads requests, cases, set-var values and if conditions", () => {
    const suite = { ...newSuite(), id: "s1", cases: [testCase("{{fromCase}}")] };
    const items: FlowItems = {
      suites: [suite],
      requests: [],
      findRequest: (id) => (id === "r1" ? { ...newRequest(), url: "{{fromRequest}}" } : null),
    };
    const flow = newFlow();
    const runRequest = { ...newNode("run-request"), requestId: "r1" };
    const runCase = { ...newNode("run-case"), suiteId: "s1", caseId: testCase("{{fromCase}}").id };
    const setVar = { ...newNode("set-var"), name: "x", value: "{{fromSet}}" };
    const cond = { ...newNode("if"), condition: { source: "variable" as const, property: "x", op: "eq" as const, expected: "{{fromIf}}" } };
    flow.nodes.push(runRequest, runCase, setVar, cond);
    expect(flowPlaceholders(flow, items).sort()).toEqual(["fromCase", "fromIf", "fromRequest", "fromSet"]);
  });
});
