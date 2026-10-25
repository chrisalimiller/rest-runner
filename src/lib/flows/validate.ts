import type { TestSuite } from "../testing/types";
import { nodeLabel, type RequestLookup } from "./flows";
import { parseCsv } from "../csv";
import { MULTI_WIRE_OUTPUTS, NODE_OUTPUTS, type Flow, type FlowNode } from "./types";

export interface FlowProblem {
  /** error: the flow cannot start. warning: it can, but something looks wrong. */
  level: "error" | "warning";
  /** The node the problem is on, when it is on one. */
  nodeId?: string;
  message: string;
}

export interface ValidateOptions {
  /** The node a run starts from. Missing means the Start node. */
  entryNodeId?: string;
}

/** Sources whose `property` must be filled in. */
const NEEDS_PROPERTY = new Set(["header", "variable"]);

function itemProblems(node: FlowNode, suites: TestSuite[], findRequest: RequestLookup): string[] {
  switch (node.type) {
    case "run-case": {
      if (!node.suiteId || !node.caseId) return ["Pick a test case to run."];
      const suite = suites.find((s) => s.id === node.suiteId);
      if (!suite) return ["The suite this step runs was deleted. Pick another case."];
      if (!suite.cases.some((c) => c.id === node.caseId)) return [`The case this step runs was deleted from "${suite.name}". Pick another case.`];
      return [];
    }
    case "run-suite": {
      if (!node.suiteId) return ["Pick a suite to run."];
      const suite = suites.find((s) => s.id === node.suiteId);
      if (!suite) return ["The suite this step runs was deleted. Pick another suite."];
      if (!suite.cases.some((c) => c.enabled)) return [`"${suite.name}" has no cases turned on, so there is nothing to run.`];
      return [];
    }
    case "run-request":
      if (!node.requestId) return ["Pick a saved request to run."];
      if (!findRequest(node.requestId)) return ["The saved request this step runs was deleted. Pick another request."];
      return [];
    case "if":
      if (NEEDS_PROPERTY.has(node.condition.source) && node.condition.property.trim() === "") {
        return [node.condition.source === "variable" ? "Enter the variable name to check." : "Enter the header name to check."];
      }
      return [];
    case "set-var":
      return node.name.trim() === "" ? ["Enter a variable name."] : [];
    case "loop": {
      if (!node.data) return ["Load a CSV file for the loop to go through."];
      if (parseCsv(node.data.text).headers.length === 0) return [`${node.data.name} has no header row.`];
      return [];
    }
    default:
      return [];
  }
}

/** Everything that stops a flow from starting (errors), plus things that look wrong but don't (warnings). */
export function validateFlow(flow: Flow, suites: TestSuite[], findRequest: RequestLookup, options: ValidateOptions = {}): FlowProblem[] {
  const problems: FlowProblem[] = [];
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const starts = flow.nodes.filter((n) => n.type === "start");

  let entry: FlowNode | undefined;
  if (options.entryNodeId) {
    entry = byId.get(options.entryNodeId);
    if (!entry) problems.push({ level: "error", message: "The step this run starts from is no longer in the flow." });
  } else if (starts.length === 0) {
    problems.push({ level: "error", message: "Add a Start node: a run begins there." });
  } else if (starts.length > 1) {
    for (const s of starts.slice(1)) problems.push({ level: "error", nodeId: s.id, message: "A flow has one Start node. Remove this one." });
    entry = starts[0];
  } else {
    entry = starts[0];
  }

  for (const node of flow.nodes) {
    for (const message of itemProblems(node, suites, findRequest)) problems.push({ level: "error", nodeId: node.id, message });
    if (node.type === "run-case") {
      const tc = suites.find((s) => s.id === node.suiteId)?.cases.find((c) => c.id === node.caseId);
      if (tc && !tc.enabled) problems.push({ level: "warning", nodeId: node.id, message: `"${tc.name}" is turned off in its suite. The flow runs it anyway.` });
    }
  }

  for (const edge of flow.edges) {
    const source = byId.get(edge.source);
    if (!source || !byId.has(edge.target) || !NODE_OUTPUTS[source.type].includes(edge.sourceHandle)) {
      problems.push({ level: "error", nodeId: source?.id, message: "A wire points at a step that no longer exists. Remove it." });
    }
    if (byId.get(edge.target)?.type === "start") {
      problems.push({ level: "error", nodeId: edge.target, message: "Nothing can be wired into Start." });
    }
    if (byId.get(edge.target)?.type === "note") {
      problems.push({ level: "error", nodeId: edge.target, message: "Sticky notes are never run, so nothing can be wired into one." });
    }
  }

  for (const node of flow.nodes) {
    for (const output of NODE_OUTPUTS[node.type]) {
      if (MULTI_WIRE_OUTPUTS.includes(output)) continue;
      const count = flow.edges.filter((e) => e.source === node.id && e.sourceHandle === output).length;
      if (count > 1) {
        problems.push({
          level: "error",
          nodeId: node.id,
          message: `The "${output}" output of "${nodeLabel(node, suites, findRequest)}" has ${count} wires. Wire it to one step.`,
        });
      }
    }
  }

  for (const node of flow.nodes) {
    const label = () => nodeLabel(node, suites, findRequest);
    const out = flow.edges.filter((e) => e.source === node.id);
    const into = flow.edges.filter((e) => e.target === node.id);
    if (node.type === "parallel" && out.length < 2) {
      problems.push({ level: "warning", nodeId: node.id, message: `"${label()}" has ${out.length === 0 ? "no branches" : "one branch"}. Wire two or more steps from it to run them at the same time.` });
    }
    if (node.type === "join" && into.length < 2) {
      problems.push({ level: "warning", nodeId: node.id, message: `"${label()}" has ${into.length === 0 ? "nothing" : "one wire"} coming in. Wire the end of each parallel branch into it.` });
    }
    if (node.type === "loop" && !out.some((e) => e.sourceHandle === "row")) {
      problems.push({ level: "warning", nodeId: node.id, message: `Nothing is wired to the "each row" output of "${label()}", so it does nothing per row.` });
    }
  }

  if (entry) {
    const reached = new Set<string>([entry.id]);
    const queue = [entry.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of flow.edges) {
        if (e.source === id && !reached.has(e.target)) {
          reached.add(e.target);
          queue.push(e.target);
        }
      }
    }
    for (const node of flow.nodes) {
      if (!reached.has(node.id) && node.type !== "start" && node.type !== "note") {
        problems.push({ level: "warning", nodeId: node.id, message: `"${nodeLabel(node, suites, findRequest)}" is not wired from the start, so it never runs.` });
      }
    }
  }

  return problems;
}

export function hasErrors(problems: FlowProblem[]): boolean {
  return problems.some((p) => p.level === "error");
}
