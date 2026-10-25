import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import { newRequest } from "../defaults";
import { inlineScriptRunner } from "../testing/scriptRunner";
import { newAssertion, newSuite, newTestCase } from "../testing/suites";
import { DEFAULT_SUITE_OPTIONS, type TestCase, type TestSuite } from "../testing/types";
import type { PreparedRequest, RequestDef, SendOutcome } from "../types";
import { FlowNotRunnableError, runFlow, type FlowRunContext } from "./engine";
import { newEdge, newFlow, newNode } from "./flows";
import type { Flow, FlowNode, FlowOutput, FlowStep } from "./types";

type Reply = { status: number; body?: string } | "error";

function fakeServer(reply: (req: PreparedRequest) => Reply, delay = 2) {
  const sent: PreparedRequest[] = [];
  const send: SendFn = async (req, signal) => {
    sent.push(req);
    await new Promise((r) => setTimeout(r, delay));
    const base = { request: req, sentAt: new Date().toISOString() };
    if (signal?.aborted) return { ...base, ok: false, error: "Request cancelled", durationMs: delay } satisfies SendOutcome;
    const r = reply(req);
    if (r === "error") return { ...base, ok: false, error: "connection refused", durationMs: delay } satisfies SendOutcome;
    return {
      ...base,
      ok: true,
      response: { status: r.status, statusText: "", headers: [["content-type", "application/json"]], body: r.body ?? "{}", sizeBytes: 2, durationMs: delay },
    } satisfies SendOutcome;
  };
  return { send, sent, urls: () => sent.map((s) => s.url) };
}

function makeCase(name: string, url: string, extra: Partial<TestCase> = {}): TestCase {
  const tc = newTestCase();
  return { ...tc, name, request: { ...tc.request, url }, assertions: [], ...extra };
}

function suiteOf(cases: TestCase[], extra: Partial<TestSuite> = {}): TestSuite {
  return { ...newSuite("Suite"), cases, options: { ...DEFAULT_SUITE_OPTIONS }, ...extra };
}

function savedRequest(name: string, url: string, extra: Partial<RequestDef> = {}): RequestDef {
  return { ...newRequest(), name, url, ...extra };
}

/** Builds a flow from a chain description: each node wired from the previous one's given output. */
function flowOf(nodes: FlowNode[], wires: [FlowNode, FlowOutput, FlowNode][]): Flow {
  const f = newFlow("Test flow");
  const start = f.nodes[0];
  return { ...f, nodes: [start, ...nodes], edges: [newEdge(start.id, "next", nodes[0].id), ...wires.map(([a, out, b]) => newEdge(a.id, out, b.id))] };
}

function ctxOf(send: SendFn, suites: TestSuite[] = [], requests: RequestDef[] = [], extra: Partial<FlowRunContext> = {}): FlowRunContext {
  return {
    suites,
    findRequest: (id) => requests.find((r) => r.id === id) ?? null,
    envVars: { host: "api.test" },
    environmentName: "Dev",
    send,
    scripts: inlineScriptRunner,
    signal: new AbortController().signal,
    ...extra,
  };
}

function runCaseNode(suite: TestSuite, tc: TestCase, retry = { times: 0, delayMs: 0 }): FlowNode {
  return { ...newNode("run-case"), type: "run-case", suiteId: suite.id, caseId: tc.id, retry } as FlowNode;
}

function runRequestNode(req: RequestDef): FlowNode {
  return { ...newNode("run-request"), type: "run-request", requestId: req.id, retry: { times: 0, delayMs: 0 } } as FlowNode;
}

const labels = (steps: FlowStep[]) => steps.map((s) => `${s.label}:${s.output ?? s.status}`);

describe("runFlow", () => {
  it("runs steps in order and passes variables from a case to a saved request", async () => {
    const server = fakeServer((req) => (req.url.endsWith("/login") ? { status: 200, body: '{"token":"abc"}' } : { status: 200 }));
    const login = makeCase("Login", "https://{{host}}/login", { postScript: `rr.vars.set("token", rr.response.json().token)` });
    const suite = suiteOf([login]);
    const me = savedRequest("Me", "https://{{host}}/me?t={{token}}");
    const a = runCaseNode(suite, login);
    const b = runRequestNode(me);
    const run = await runFlow(flowOf([a, b], [[a, "passed", b]]), ctxOf(server.send, [suite], [me]));

    expect(server.urls()).toEqual(["https://api.test/login", "https://api.test/me?t=abc"]);
    expect(run.end).toBe("passed");
    expect(labels(run.stepList)).toEqual(["Start:next", "Suite › Login:passed", "Me:passed"]);
    expect(run.stepList[2].varsBefore).toEqual({ token: "abc" });
    expect(run.vars).toEqual({ token: "abc" });
    expect(run.passedSteps).toBe(2);
    expect(run.stepList[1].child?.results).toHaveLength(1);
    expect(run.stepList[1].child?.environmentName).toBe("Dev");
  });

  it("follows the failed wire, keeps going, and still passes with the failure counted", async () => {
    const server = fakeServer((req) => (req.url.endsWith("/health") ? { status: 500 } : { status: 200 }));
    const tc = makeCase("Health", "https://{{host}}/health");
    const suite = suiteOf([tc]);
    const cleanup = savedRequest("Cleanup", "https://{{host}}/cleanup");
    const a = runCaseNode(suite, tc);
    const b = runRequestNode(cleanup);
    const run = await runFlow(flowOf([a, b], [[a, "failed", b]]), ctxOf(server.send, [suite], [cleanup]));
    expect(run.end).toBe("passed");
    expect(run.failedSteps).toBe(1);
    expect(run.passedSteps).toBe(1);
    expect(run.stepList[1].notes.join(" ")).toMatch(/Status is below 400/);
    expect(run.log.some((l) => /following its failed wire/.test(l.message))).toBe(true);
  });

  it("marks the flow failed when a failed step has no failed wire", async () => {
    const server = fakeServer(() => ({ status: 500 }));
    const tc = makeCase("Health", "https://{{host}}/health");
    const suite = suiteOf([tc]);
    const next = savedRequest("Next", "https://{{host}}/next");
    const a = runCaseNode(suite, tc);
    const b = runRequestNode(next);
    const run = await runFlow(flowOf([a, b], [[a, "passed", b]]), ctxOf(server.send, [suite], [next]));
    expect(run.end).toBe("failed");
    expect(run.endReason).toMatch(/"Suite › Health" failed and nothing is wired/);
    expect(server.urls()).toEqual(["https://api.test/health"]);
    expect(run.stepList.at(-1)?.nextNodeId).toBeNull();
  });

  it("passes a saved request on a 500 when its scripts have no failing rr.test", async () => {
    const server = fakeServer(() => ({ status: 500 }));
    const plain = savedRequest("Plain", "https://{{host}}/a");
    const tested = savedRequest("Tested", "https://{{host}}/b", { postScript: `rr.test("is 200", () => rr.expect(rr.response.status).toBe(200))` });
    const a = runRequestNode(plain);
    const b = runRequestNode(tested);
    const run = await runFlow(flowOf([a, b], [[a, "passed", b]]), ctxOf(server.send, [], [plain, tested]));
    expect(run.stepList[1].status).toBe("passed");
    expect(run.stepList[2].status).toBe("failed");
    expect(run.end).toBe("failed");
  });

  it("fails a saved request when no response comes back", async () => {
    const server = fakeServer(() => "error");
    const req = savedRequest("Down", "https://{{host}}/down");
    const a = runRequestNode(req);
    const run = await runFlow(flowOf([a], []), ctxOf(server.send, [], [req]));
    expect(run.stepList[1].status).toBe("failed");
    expect(run.stepList[1].notes.join(" ")).toMatch(/connection refused/);
  });

  it("branches with If on a variable, the last result and the last response", async () => {
    const server = fakeServer(() => ({ status: 201, body: '{"state":"ready"}' }));
    const req = savedRequest("Create", "https://{{host}}/create", { postScript: `rr.vars.set("kind", "admin")` });
    const run1 = runRequestNode(req);
    const ifVar: FlowNode = { ...newNode("if"), type: "if", condition: { source: "variable", property: "kind", op: "eq", expected: "admin" } };
    const ifLast: FlowNode = { ...newNode("if"), type: "if", condition: { source: "last-result", property: "", op: "eq", expected: "passed" } };
    const ifJson: FlowNode = { ...newNode("if"), type: "if", condition: { source: "json", property: "$.state", op: "eq", expected: "{{want}}" } };
    const setWant: FlowNode = { ...newNode("set-var"), type: "set-var", name: "want", value: "rea{{missing}}dy" };
    const setWant2: FlowNode = { ...newNode("set-var"), type: "set-var", name: "want", value: "ready" };
    const wrong: FlowNode = { ...newNode("wait"), type: "wait", ms: 0, label: "Wrong" };
    const right: FlowNode = { ...newNode("wait"), type: "wait", ms: 0, label: "Right" };
    const flow = flowOf(
      [run1, ifVar, ifLast, setWant, setWant2, ifJson, wrong, right],
      [
        [run1, "passed", ifVar],
        [ifVar, "true", ifLast],
        [ifVar, "false", wrong],
        [ifLast, "true", setWant],
        [setWant, "next", setWant2],
        [setWant2, "next", ifJson],
        [ifJson, "true", right],
        [ifJson, "false", wrong],
      ],
    );
    const run = await runFlow(flow, ctxOf(server.send, [], [req]));
    expect(run.end).toBe("passed");
    expect(run.stepList.map((s) => s.output)).toEqual(["next", "passed", "true", "true", "next", "next", "true", "next"]);
    expect(run.stepList[4].varsAfter.want).toBe("rea{{missing}}dy");
    expect(run.stepList.at(-1)?.label).toBe("Right");
    expect(run.stepList[6].notes[0]).toMatch(/Last response: JSON path \$\.state equals ready: true/);
  });

  it("retries a failed step, restoring variables between tries, and passes when a try passes", async () => {
    let calls = 0;
    const server = fakeServer(() => (++calls < 3 ? { status: 503 } : { status: 200 }));
    const tc = makeCase("Flaky", "https://{{host}}/flaky", { preScript: `rr.vars.set("n", String(Number(rr.vars.get("n") ?? "0") + 1))` });
    const suite = suiteOf([tc]);
    const a = runCaseNode(suite, tc, { times: 3, delayMs: 1 });
    const run = await runFlow(flowOf([a], []), ctxOf(server.send, [suite]));
    const step = run.stepList[1];
    expect(step.status).toBe("passed");
    expect(step.attempts?.map((t) => t.passed)).toEqual([false, false, true]);
    expect(step.notes[0]).toBe("Passed on try 3 of 4.");
    expect(run.vars.n).toBe("1");
  });

  it("fails after every try fails", async () => {
    const server = fakeServer(() => ({ status: 500 }));
    const tc = makeCase("Down", "https://{{host}}/down");
    const suite = suiteOf([tc]);
    const a = runCaseNode(suite, tc, { times: 1, delayMs: 0 });
    const run = await runFlow(flowOf([a], []), ctxOf(server.send, [suite]));
    expect(run.stepList[1].attempts).toHaveLength(2);
    expect(run.stepList[1].notes[0]).toBe("Failed all 2 tries.");
    expect(server.sent).toHaveLength(2);
  });

  it("runs a whole suite with its CSV, starting each row from the flow variables and carrying out the last row's", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const tc = makeCase("Get", "https://{{host}}/u/{{id}}?t={{token}}", { postScript: `rr.vars.set("last", rr.data.id)` });
    const suite = suiteOf([tc], { data: { name: "users.csv", text: "id\n1\n2\n3" } });
    const set: FlowNode = { ...newNode("set-var"), type: "set-var", name: "token", value: "t-{{host}}" };
    const runSuiteNode: FlowNode = { ...newNode("run-suite"), type: "run-suite", suiteId: suite.id, retry: { times: 0, delayMs: 0 } };
    const run = await runFlow(flowOf([set, runSuiteNode], [[set, "next", runSuiteNode]]), ctxOf(server.send, [suite]));
    expect(server.urls()).toEqual(["https://api.test/u/1?t=t-api.test", "https://api.test/u/2?t=t-api.test", "https://api.test/u/3?t=t-api.test"]);
    expect(run.vars).toEqual({ token: "t-api.test", last: "3" });
    const child = run.stepList[2].child!;
    expect(child.csvName).toBe("users.csv");
    expect(child.iterations).toBe(3);
    expect(child.passed).toBe(3);
  });

  it("uses the live suite as it is when the run starts", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const tc = makeCase("Old", "https://{{host}}/old");
    const suite = suiteOf([tc]);
    const edited: TestSuite = { ...suite, cases: [{ ...tc, request: { ...tc.request, url: "https://{{host}}/new" } }] };
    const a = runCaseNode(suite, tc);
    await runFlow(flowOf([a], []), ctxOf(server.send, [edited]));
    expect(server.urls()).toEqual(["https://api.test/new"]);
  });

  it("checks the case's own assertions with the suite's settings", async () => {
    const server = fakeServer(() => ({ status: 404 }));
    const tc = makeCase("Missing", "https://{{host}}/x", { assertions: [newAssertion({ source: "status", op: "eq", expected: "404" })] });
    const suite = suiteOf([tc]);
    const run = await runFlow(flowOf([runCaseNode(suite, tc)], []), ctxOf(server.send, [suite]));
    expect(run.stepList[1].status).toBe("passed");
  });

  it("stops a flow that loops forever after the step limit", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const w: FlowNode = { ...newNode("wait"), type: "wait", ms: 0 };
    const i: FlowNode = { ...newNode("if"), type: "if", condition: { source: "variable", property: "done", op: "exists", expected: "" } };
    const run = await runFlow(
      flowOf([w, i], [
        [w, "next", i],
        [i, "false", w],
      ]),
      ctxOf(server.send, [], [], { maxSteps: 20 }),
    );
    expect(run.end).toBe("failed");
    expect(run.steps).toBe(20);
    expect(run.endReason).toMatch(/Stopped after 20 steps/);
  });

  it("is cancelled when Stop is pressed during a step", async () => {
    const controller = new AbortController();
    const server = fakeServer(() => ({ status: 200 }));
    const w: FlowNode = { ...newNode("wait"), type: "wait", ms: 10_000 };
    const after = savedRequest("After", "https://{{host}}/after");
    const b = runRequestNode(after);
    setTimeout(() => controller.abort(), 10);
    const run = await runFlow(flowOf([w, b], [[w, "next", b]]), ctxOf(server.send, [], [after], { signal: controller.signal }));
    expect(run.end).toBe("cancelled");
    expect(run.endReason).toBe("Stopped by you.");
    expect(run.stepList.at(-1)?.status).toBe("cancelled");
    expect(server.sent).toHaveLength(0);
  });

  it("starts from another node when asked", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const req = savedRequest("Only", "https://{{host}}/only");
    const flow = newFlow();
    const node = runRequestNode(req);
    flow.nodes.push(node);
    const run = await runFlow(flow, ctxOf(server.send, [], [req], { entryNodeId: node.id, trigger: "sched-1" }));
    expect(run.trigger).toBe("sched-1");
    expect(run.stepList.map((s) => s.label)).toEqual(["Only"]);
  });

  it("refuses to start a flow whose items are missing", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const a = runRequestNode(savedRequest("Gone", "https://x"));
    await expect(runFlow(flowOf([a], []), ctxOf(server.send))).rejects.toThrow(FlowNotRunnableError);
    await expect(runFlow(flowOf([a], []), ctxOf(server.send))).rejects.toThrow(/saved request this step runs was deleted/);
  });
});
