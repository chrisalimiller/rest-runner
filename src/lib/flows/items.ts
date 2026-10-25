import { parseCsv } from "../csv";
import { load } from "../storage";
import { listPickableRequests, type PickableRequest } from "../testing/requestSources";
import { cleanSuites } from "../testing/suites";
import type { TestSuite } from "../testing/types";
import { describeCondition } from "./conditions";
import { formatMs, type RequestLookup } from "./flows";
import type { FlowNode } from "./types";

const SUITES_KEY = "rest-runner.test-suites";

/** The saved items a flow can run, read fresh from storage (Testing and Requests save as they change). */
export interface FlowItems {
  suites: TestSuite[];
  requests: PickableRequest[];
  findRequest: RequestLookup;
}

export function readFlowItems(): FlowItems {
  const suites = cleanSuites(load(SUITES_KEY, []));
  const requests = listPickableRequests();
  const byId = new Map(requests.map((r) => [r.id, r.request]));
  return { suites, requests, findRequest: (id) => byId.get(id) ?? null };
}

/** A second line for a node on the canvas: what exactly it runs or checks. */
export function nodeDetail(node: FlowNode, items: FlowItems): string {
  switch (node.type) {
    case "start":
      return "Run begins here";
    case "schedule":
      return node.enabled ? "While the app is open" : "Turned off";
    case "run-case": {
      const suite = items.suites.find((s) => s.id === node.suiteId);
      const tc = suite?.cases.find((c) => c.id === node.caseId);
      return tc ? `${tc.request.method} ${tc.request.url}` : "No case picked";
    }
    case "run-suite": {
      const suite = items.suites.find((s) => s.id === node.suiteId);
      if (!suite) return "No suite picked";
      const n = suite.cases.filter((c) => c.enabled).length;
      return `${n} case${n === 1 ? "" : "s"}${suite.data ? ` · ${suite.data.name}` : ""}`;
    }
    case "run-request": {
      const r = items.findRequest(node.requestId);
      return r ? `${r.method} ${r.url}` : "No request picked";
    }
    case "if":
      return describeCondition(node.condition);
    case "parallel":
      return "Starts every branch at once";
    case "join":
      return "Waits for every branch";
    case "loop": {
      if (!node.data) return "No CSV loaded";
      const rows = parseCsv(node.data.text).rows.length;
      return `${rows} row${rows === 1 ? "" : "s"} · ${node.data.name}`;
    }
    case "wait":
      return formatMs(node.ms);
    case "set-var":
      return node.name ? `${node.name} = ${node.value}` : "No name yet";
    case "note":
      return "";
  }
}
