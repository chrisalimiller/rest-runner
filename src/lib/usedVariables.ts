import type { Flow } from "./flows/types";
import type { FlowItems } from "./flows/items";
import { requestPlaceholders } from "./request";
import { findPlaceholders } from "./template";
import type { TestCase, TestSuite } from "./testing/types";

const unique = (names: string[]) => [...new Set(names)];

/** The {{placeholders}} a test case uses: its request, and what its assertions expect. */
export function casePlaceholders(c: TestCase): string[] {
  return unique([...requestPlaceholders(c.request), ...c.assertions.filter((a) => a.enabled).flatMap((a) => findPlaceholders(a.expected))]);
}

/** The placeholders any enabled case of a suite uses. */
export function suitePlaceholders(suite: TestSuite): string[] {
  return unique(suite.cases.filter((c) => c.enabled).flatMap(casePlaceholders));
}

/** The placeholders the steps of a flow use: the requests, cases and suites it runs, Set variable values and If conditions. */
export function flowPlaceholders(flow: Flow, items: FlowItems): string[] {
  const names: string[] = [];
  for (const node of flow.nodes) {
    if (node.type === "run-request") {
      const request = items.findRequest(node.requestId);
      if (request) names.push(...requestPlaceholders(request));
    } else if (node.type === "run-case") {
      const c = items.suites.find((s) => s.id === node.suiteId)?.cases.find((x) => x.id === node.caseId);
      if (c) names.push(...casePlaceholders(c));
    } else if (node.type === "run-suite") {
      const suite = items.suites.find((s) => s.id === node.suiteId);
      if (suite) names.push(...suitePlaceholders(suite));
    } else if (node.type === "set-var") names.push(...findPlaceholders(node.value));
    else if (node.type === "if") names.push(...findPlaceholders(node.condition.expected));
  }
  return unique(names);
}
