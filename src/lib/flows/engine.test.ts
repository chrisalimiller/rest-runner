import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import { newRequest } from "../defaults";
import { inlineScriptRunner } from "../testing/scriptRunner";
import { newAssertion, newSuite, newTestCase } from "../testing/suites";
import { DEFAULT_SUITE_OPTIONS, type TestCase, type TestSuite } from "../testing/types";
import type { PreparedRequest, RequestDef, SendOutcome } from "../types";
import { FlowNotRunnableError, runFlow, type FlowRunContext } from "./engine";
import { newEdge, newFlow, newNode } from "./flows";
import { validateFlow } from "./validate";
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

function node<T extends FlowNode["type"]>(type: T, extra: Partial<Extract<FlowNode, { type: T }>> = {}): FlowNode {
  return { ...newNode(type), ...extra } as FlowNode;
}

describe("Parallel and Join", () => {
  it("starts branches at once, merges their variables with the last finisher winning, and continues", async () => {
    const server = fakeServer(() => ({ status: 200 }), 1);
    const send: SendFn = async (req, signal) => {
      if (req.url.endsWith("/slow")) await new Promise((r) => setTimeout(r, 40));
      return server.send(req, signal);
    };
    const slow = savedRequest("Slow", "https://{{host}}/slow", { preScript: `rr.vars.set("who", "slow"); rr.vars.set("a", "1")` });
    const fast = savedRequest("Fast", "https://{{host}}/fast", { preScript: `rr.vars.set("who", "fast"); rr.vars.set("b", "2")` });
    const after = savedRequest("After", "https://{{host}}/after?who={{who}}&a={{a}}&b={{b}}");
    const par = node("parallel");
    const join = node("join");
    const a = runRequestNode(slow);
    const b = runRequestNode(fast);
    const c = runRequestNode(after);
    const flow = flowOf([par, a, b, join, c], [
      [par, "branches", a],
      [par, "branches", b],
      [a, "passed", join],
      [b, "passed", join],
      [join, "passed", c],
    ]);
    const run = await runFlow(flow, ctxOf(send, [], [slow, fast, after]));
    expect(run.end).toBe("passed");
    expect(server.urls().at(-1)).toBe("https://api.test/after?who=slow&a=1&b=2");
    const steps = [...run.stepList].sort((x, y) => x.index - y.index);
    expect(steps.map((s) => s.nodeType)).toEqual(["start", "parallel", "run-request", "run-request", "join", "run-request"]);
    expect(steps.filter((s) => s.nodeType === "run-request").slice(0, 2).map((s) => s.branch).sort()).toEqual(["1", "2"]);
    expect(steps[4].status).toBe("passed");
  });

  it("fails the Join when a branch failed, after waiting for every branch", async () => {
    const server = fakeServer((req) => (req.url.endsWith("/bad") ? { status: 500 } : { status: 200 }));
    const bad = makeCase("Bad", "https://{{host}}/bad");
    const good = makeCase("Good", "https://{{host}}/good");
    const suite = suiteOf([bad, good]);
    const cleanup = savedRequest("Cleanup", "https://{{host}}/cleanup");
    const par = node("parallel");
    const join = node("join");
    const a = runCaseNode(suite, bad);
    const b = runCaseNode(suite, good);
    const c = runRequestNode(cleanup);
    const wires: [FlowNode, FlowOutput, FlowNode][] = [
      [par, "branches", a],
      [par, "branches", b],
      [a, "passed", join],
      [b, "passed", join],
    ];
    const unwired = await runFlow(flowOf([par, a, b, join, c], wires), ctxOf(server.send, [suite], [cleanup]));
    expect(unwired.end).toBe("failed");
    expect(unwired.endReason).toMatch(/Join" failed because a branch failed/);
    expect(server.urls()).toContain("https://api.test/good");
    const join1 = unwired.stepList.find((s) => s.nodeType === "join")!;
    expect(join1.notes.join(" ")).toMatch(/Branch 1: "Suite › Bad"/);

    const handled = await runFlow(flowOf([par, a, b, join, c], [...wires, [join, "failed", c]]), ctxOf(server.send, [suite], [cleanup]));
    expect(handled.end).toBe("passed");
    expect(handled.stepList.at(-1)?.label).toBe("Cleanup");
  });

  it("ends the flow after all branches when there is no Join", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const r1 = savedRequest("One", "https://{{host}}/1");
    const r2 = savedRequest("Two", "https://{{host}}/2");
    const par = node("parallel");
    const a = runRequestNode(r1);
    const b = runRequestNode(r2);
    const run = await runFlow(flowOf([par, a, b], [
      [par, "branches", a],
      [par, "branches", b],
    ]), ctxOf(server.send, [], [r1, r2]));
    expect(run.end).toBe("passed");
    expect(server.sent).toHaveLength(2);
  });

  it("refuses branches that meet at different Joins", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const par = node("parallel");
    const w1 = node("wait", { ms: 0 });
    const w2 = node("wait", { ms: 0 });
    const j1 = node("join");
    const j2 = node("join");
    const run = await runFlow(flowOf([par, w1, w2, j1, j2], [
      [par, "branches", w1],
      [par, "branches", w2],
      [w1, "next", j1],
      [w2, "next", j2],
    ]), ctxOf(server.send));
    expect(run.end).toBe("failed");
    expect(run.endReason).toMatch(/different Join/);
  });

  it("lets a Parallel's output have many wires", () => {
    const par = node("parallel");
    const w1 = node("wait");
    const w2 = node("wait");
    const f = flowOf([par, w1, w2], [
      [par, "branches", w1],
      [par, "branches", w2],
    ]);
    expect(validateFlow(f, [], () => null).filter((p) => p.level === "error")).toEqual([]);
  });
});

describe("Loop over CSV", () => {
  const csv = { name: "users.csv", text: "id,name\n1,Ann\n2,Bob\n3,Cy" };

  it("runs the body once per row with columns filled in, carrying variables between rows, then continues from done", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const get = savedRequest("Get user", "https://{{host}}/u/{{id}}?name={{name}}&prev={{prev}}", { postScript: `rr.vars.set("prev", rr.data.id)` });
    const after = savedRequest("After", "https://{{host}}/after?prev={{prev}}");
    const loop = node("loop", { data: csv });
    const a = runRequestNode(get);
    const b = runRequestNode(after);
    const run = await runFlow(flowOf([loop, a, b], [
      [loop, "row", a],
      [loop, "done", b],
    ]), ctxOf(server.send, [], [get, after]));
    expect(server.urls()).toEqual([
      "https://api.test/u/1?name=Ann&prev={{prev}}",
      "https://api.test/u/2?name=Bob&prev=1",
      "https://api.test/u/3?name=Cy&prev=2",
      "https://api.test/after?prev=3",
    ]);
    expect(run.end).toBe("passed");
    const steps = [...run.stepList].sort((x, y) => x.index - y.index);
    expect(steps[1].nodeType).toBe("loop");
    expect(steps[1].output).toBe("done");
    expect(steps.filter((s) => s.nodeType === "run-request").map((s) => s.row)).toEqual([0, 1, 2, undefined]);
  });

  it("treats a wire back into the loop as the end of a row", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const get = savedRequest("Get", "https://{{host}}/u/{{id}}");
    const loop = node("loop", { data: csv });
    const a = runRequestNode(get);
    const run = await runFlow(flowOf([loop, a], [
      [loop, "row", a],
      [a, "passed", loop],
    ]), ctxOf(server.send, [], [get]));
    expect(server.sent).toHaveLength(3);
    expect(run.end).toBe("passed");
  });

  it("runs every row, then fails the flow when a row failed with nothing to handle it", async () => {
    const server = fakeServer((req) => (req.url.endsWith("/2") ? { status: 500 } : { status: 200 }));
    const tc = makeCase("Get", "https://{{host}}/u/{{id}}");
    const suite = suiteOf([tc]);
    const after = savedRequest("After", "https://{{host}}/after");
    const loop = node("loop", { data: csv });
    const a = runCaseNode(suite, tc);
    const b = runRequestNode(after);
    const run = await runFlow(flowOf([loop, a, b], [
      [loop, "row", a],
      [loop, "done", b],
    ]), ctxOf(server.send, [suite], [after]));
    expect(server.urls()).toEqual(["https://api.test/u/1", "https://api.test/u/2", "https://api.test/u/3"]);
    expect(run.end).toBe("failed");
    expect(run.endReason).toMatch(/1 of 3 rows of "Loop over users.csv" failed/);
    const loopStep = run.stepList.find((s) => s.nodeType === "loop")!;
    expect(loopStep.status).toBe("failed");
    expect(loopStep.notes.join(" ")).toMatch(/Row 2: "Suite › Get"/);
  });

  it("needs a CSV", () => {
    const f = flowOf([node("loop")], []);
    expect(validateFlow(f, [], () => null).find((p) => p.level === "error")?.message).toMatch(/Load a CSV/);
  });
});
