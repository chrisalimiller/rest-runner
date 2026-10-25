import { describe, expect, it } from "vitest";
import { newRequest } from "../defaults";
import { newSuite, newTestCase } from "../testing/suites";
import type { TestSuite } from "../testing/types";
import type { ResponseResult } from "../types";
import { evaluateCondition } from "./conditions";
import { cleanFlows, newEdge, newFlow, newNode, nodeLabel } from "./flows";
import type { Flow, FlowNode } from "./types";
import { hasErrors, validateFlow } from "./validate";

const noRequests = () => null;

function suiteWithCase(): { suite: TestSuite; caseId: string } {
  const tc = newTestCase();
  const suite = { ...newSuite("Users"), cases: [{ ...tc, name: "List" }] };
  return { suite, caseId: tc.id };
}

function withNodes(nodes: FlowNode[]): Flow {
  const f = newFlow();
  return { ...f, nodes: [...f.nodes, ...nodes] };
}

describe("validateFlow", () => {
  it("accepts a new flow", () => {
    expect(validateFlow(newFlow(), [], noRequests)).toEqual([]);
  });

  it("needs exactly one Start", () => {
    const none = { ...newFlow(), nodes: [] };
    expect(validateFlow(none, [], noRequests)[0].message).toMatch(/Add a Start node/);
    const two = withNodes([newNode("start")]);
    const problems = validateFlow(two, [], noRequests);
    expect(problems.filter((p) => p.level === "error")).toHaveLength(1);
    expect(problems[0].nodeId).toBe(two.nodes[1].id);
  });

  it("flags Run nodes with nothing picked or a deleted item", () => {
    const { suite, caseId } = suiteWithCase();
    const unpicked = newNode("run-case");
    const goneCase: FlowNode = { ...newNode("run-case"), type: "run-case", suiteId: suite.id, caseId: "nope", retry: { times: 0, delayMs: 0 } };
    const goneSuite: FlowNode = { ...newNode("run-suite"), type: "run-suite", suiteId: "nope", retry: { times: 0, delayMs: 0 } };
    const goneRequest: FlowNode = { ...newNode("run-request"), type: "run-request", requestId: "nope", retry: { times: 0, delayMs: 0 } };
    const ok: FlowNode = { ...newNode("run-case"), type: "run-case", suiteId: suite.id, caseId, retry: { times: 0, delayMs: 0 } };
    const flow = withNodes([unpicked, goneCase, goneSuite, goneRequest, ok]);
    const errors = validateFlow(flow, [suite], noRequests).filter((p) => p.level === "error");
    expect(errors.map((p) => p.nodeId)).toEqual([unpicked.id, goneCase.id, goneSuite.id, goneRequest.id]);
    expect(errors[1].message).toMatch(/deleted from "Users"/);
  });

  it("refuses an output with two wires and wires into Start", () => {
    const a = newNode("wait");
    const b = newNode("wait");
    const f = withNodes([a, b]);
    const start = f.nodes[0];
    f.edges = [newEdge(start.id, "next", a.id), newEdge(start.id, "next", b.id), newEdge(a.id, "next", start.id)];
    const messages = validateFlow(f, [], noRequests).map((p) => p.message);
    expect(messages.some((m) => /"next" output of "Start" has 2 wires/.test(m))).toBe(true);
    expect(messages.some((m) => /Nothing can be wired into Start/.test(m))).toBe(true);
  });

  it("warns about steps that are never reached, and checks If and Set variable settings", () => {
    const lonely = newNode("wait");
    const ifNode: FlowNode = { ...newNode("if"), type: "if", condition: { source: "variable", property: " ", op: "eq", expected: "" } };
    const setVar = newNode("set-var");
    const problems = validateFlow(withNodes([lonely, ifNode, setVar]), [], noRequests);
    expect(problems.filter((p) => p.level === "warning")).toHaveLength(3);
    expect(problems.find((p) => p.nodeId === ifNode.id && p.level === "error")?.message).toMatch(/variable name/);
    expect(problems.find((p) => p.nodeId === setVar.id && p.level === "error")?.message).toMatch(/variable name/);
    expect(hasErrors(problems)).toBe(true);
  });
});

describe("sticky notes", () => {
  it("are never warned about and can't be wired into", () => {
    const note = newNode("note");
    const f = withNodes([note]);
    expect(validateFlow(f, [], noRequests)).toEqual([]);
    f.edges = [newEdge(f.nodes[0].id, "next", note.id)];
    expect(validateFlow(f, [], noRequests)[0].message).toMatch(/Sticky notes are never run/);
  });

  it("keep their text and size through cleaning", () => {
    const f = withNodes([{ ...newNode("note"), type: "note", text: "Hi", width: 10, height: 300 } as FlowNode]);
    const [clean] = cleanFlows([f]);
    expect(clean.nodes[1]).toMatchObject({ type: "note", text: "Hi", width: 80, height: 300 });
  });
});

describe("cleanFlows", () => {
  it("keeps good nodes and wires and drops broken ones", () => {
    const f = newFlow("Kept");
    const w = newNode("wait");
    const raw = {
      ...f,
      nodes: [...f.nodes, w, { id: "x", type: "teleport" }, { ...newNode("run-case"), retry: { times: "2" } }],
      edges: [newEdge(f.nodes[0].id, "next", w.id), newEdge(w.id, "passed", f.nodes[0].id), newEdge("ghost", "next", w.id)],
    };
    const [clean] = cleanFlows([raw, null, { name: "no id" }]);
    expect(clean.name).toBe("Kept");
    expect(clean.nodes.map((n) => n.type)).toEqual(["start", "wait", "run-case"]);
    expect(clean.nodes[2]).toMatchObject({ retry: { times: 2, delayMs: 1000 } });
    expect(clean.edges).toHaveLength(1);
    expect(cleanFlows("nope")).toEqual([]);
  });
});

describe("nodeLabel", () => {
  it("uses the node's own label, then the item's name", () => {
    const { suite, caseId } = suiteWithCase();
    const req = { ...newRequest(), name: "Health" };
    const find = (id: string) => (id === req.id ? req : null);
    const rc: FlowNode = { ...newNode("run-case"), type: "run-case", suiteId: suite.id, caseId, retry: { times: 0, delayMs: 0 } };
    const rr: FlowNode = { ...newNode("run-request"), type: "run-request", requestId: req.id, retry: { times: 0, delayMs: 0 } };
    expect(nodeLabel(rc, [suite], find)).toBe("Users › List");
    expect(nodeLabel(rr, [suite], find)).toBe("Health");
    expect(nodeLabel({ ...rr, label: " Ping " }, [suite], find)).toBe("Ping");
    expect(nodeLabel({ ...newNode("wait"), type: "wait", ms: 2000 }, [], find)).toBe("Wait 2 s");
  });
});

describe("evaluateCondition", () => {
  const res: ResponseResult = { status: 404, statusText: "", headers: [["X-Id", "7"]], body: '{"items":[1,2]}', sizeBytes: 10, durationMs: 120 };
  const input = { vars: { role: "admin", count: "3" }, lastResult: "failed" as const, lastResponse: res };

  it("checks variables", () => {
    expect(evaluateCondition({ source: "variable", property: "role", op: "eq", expected: "admin" }, input).passed).toBe(true);
    expect(evaluateCondition({ source: "variable", property: "count", op: "gt", expected: "2" }, input).passed).toBe(true);
    expect(evaluateCondition({ source: "variable", property: "nope", op: "notExists", expected: "" }, input).passed).toBe(true);
    expect(evaluateCondition({ source: "variable", property: "role", op: "eq", expected: "{{role}}" }, input).passed).toBe(true);
  });

  it("checks the last result and the last response", () => {
    expect(evaluateCondition({ source: "last-result", property: "", op: "eq", expected: "failed" }, input).passed).toBe(true);
    expect(evaluateCondition({ source: "status", property: "", op: "eq", expected: "4xx" }, input).passed).toBe(true);
    expect(evaluateCondition({ source: "json", property: "$.items", op: "contains", expected: "2" }, input).passed).toBe(true);
    expect(evaluateCondition({ source: "header", property: "x-id", op: "eq", expected: "7" }, input).passed).toBe(true);
  });

  it("counts as false when there is nothing to check yet", () => {
    const empty = { vars: {}, lastResult: null, lastResponse: null };
    const c = evaluateCondition({ source: "status", property: "", op: "eq", expected: "200" }, empty);
    expect(c.passed).toBe(false);
    expect(c.message).toMatch(/No response/);
    expect(evaluateCondition({ source: "last-result", property: "", op: "neq", expected: "failed" }, empty).passed).toBe(false);
  });
});
