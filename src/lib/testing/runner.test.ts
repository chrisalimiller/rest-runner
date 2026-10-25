import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import type { PreparedRequest, SendOutcome } from "../types";
import { planIterations, runSuite } from "./runner";
import { inlineScriptRunner } from "./scriptRunner";
import { newAssertion, newSuite, newTestCase } from "./suites";
import { buildTestRun, caseStats } from "./testRun";
import { DEFAULT_SUITE_OPTIONS, type CaseResult, type SuiteRunOptions, type TestCase, type TestSuite } from "./types";

type Reply = { status: number; body?: string } | "error";

function fakeServer(reply: (req: PreparedRequest) => Reply, delay = 5) {
  const sent: PreparedRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send: SendFn = async (req, signal) => {
    sent.push(req);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, delay));
    inFlight -= 1;
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
  return { send, sent, maxInFlight: () => maxInFlight };
}

function makeCase(name: string, url: string, extra: Partial<TestCase> = {}): TestCase {
  const tc = newTestCase();
  return { ...tc, name, request: { ...tc.request, url }, assertions: [], ...extra };
}

function suiteOf(cases: TestCase[], options: Partial<SuiteRunOptions> = {}): TestSuite {
  return { ...newSuite("S"), cases, options: { ...DEFAULT_SUITE_OPTIONS, ...options } };
}

async function run(suite: TestSuite, send: SendFn, rows: Record<string, string>[] | null = null, signal = new AbortController().signal) {
  const results: CaseResult[] = [];
  const end = await runSuite(suite, { rows, envVars: { host: "api.test" }, send, scripts: inlineScriptRunner, signal, onResult: (r) => results.push(r) });
  return { end, results };
}

describe("planIterations", () => {
  it("goes round the rows once per repeat", () => {
    const plan = planIterations([{ a: "1" }, { a: "2" }], 2);
    expect(plan.map((p) => [p.iteration, p.rowIndex, p.repeatIndex])).toEqual([
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 1],
      [3, 1, 1],
    ]);
    expect(planIterations(null, 3).map((p) => p.rowIndex)).toEqual([null, null, null]);
  });
});

describe("runSuite", () => {
  it("runs cases in order and passes variables from one case to the next", async () => {
    const server = fakeServer((req) => (req.url.endsWith("/login") ? { status: 200, body: '{"token":"abc"}' } : { status: 200 }));
    const login = makeCase("Login", "https://{{host}}/login", { postScript: `rr.vars.set("token", rr.response.json().token)` });
    const me = makeCase("Me", "https://{{host}}/me?t={{token}}");
    const { end, results } = await run(suiteOf([login, me]), server.send);
    expect(end).toBe("completed");
    expect(server.sent.map((s) => s.url)).toEqual(["https://api.test/login", "https://api.test/me?t=abc"]);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("runs the suite once per CSV row with columns filled in, starting each row with fresh variables", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const a = makeCase("A", "https://{{host}}/u/{{id}}?seen={{seen}}", { postScript: `rr.vars.set("seen", "yes")` });
    const { results } = await run(suiteOf([a]), server.send, [{ id: "1" }, { id: "2" }]);
    expect(server.sent.map((s) => s.url)).toEqual(["https://api.test/u/1?seen={{seen}}", "https://api.test/u/2?seen={{seen}}"]);
    expect(results.map((r) => r.rowIndex)).toEqual([0, 1]);
    expect(results[0].notes[0]).toMatch(/\{\{seen\}\}/);
  });

  it("fails a case on assertions, script tests and 4xx, and explains each", async () => {
    const server = fakeServer((req) => (req.url.includes("missing") ? { status: 404 } : { status: 200, body: '{"id":1}' }));
    const good = makeCase("Good", "https://x/ok", {
      assertions: [newAssertion({ source: "json", property: "$.id", op: "eq", expected: "1" })],
      postScript: `rr.test("fast", () => rr.expect(rr.response.time).toBeLessThan(1000))`,
    });
    const badAssert = makeCase("Bad assert", "https://x/ok", { assertions: [newAssertion({ source: "json", property: "$.id", op: "eq", expected: "2" })] });
    const notFound = makeCase("404", "https://x/missing");
    const expected404 = makeCase("Expected 404", "https://x/missing", { assertions: [newAssertion({ source: "status", op: "eq", expected: "404" })] });
    const { results } = await run(suiteOf([good, badAssert, notFound, expected404]), server.send);
    expect(results.map((r) => [r.caseName, r.passed])).toEqual([
      ["Good", true],
      ["Bad assert", false],
      ["404", false],
      ["Expected 404", true],
    ]);
    expect(results[0].checks.map((c) => c.name)).toEqual(["JSON path $.id equals 1", "Status is below 400", "fast"]);
    expect(results[2].checks.find((c) => !c.passed)?.name).toBe("Status is below 400");
  });

  it("does not send the request when the pre-request script throws", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const tc = makeCase("Broken", "https://x/", { preScript: "throw new Error('nope')" });
    const { results } = await run(suiteOf([tc]), server.send);
    expect(server.sent).toHaveLength(0);
    expect(results[0].passed).toBe(false);
    expect(results[0].outcome).toBeUndefined();
    expect(results[0].checks[0]).toMatchObject({ name: "Pre-request script ran", passed: false, message: "nope" });
  });

  it("lets a pre-request script set variables used by the request", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const tc = makeCase("Pre", "https://x/{{when}}", { preScript: `rr.vars.set("when", "row" + rr.data.n)` });
    await run(suiteOf([tc]), server.send, [{ n: "5" }]);
    expect(server.sent[0].url).toBe("https://x/row5");
  });

  it("marks a connection error as a failure and skips the post-response script", async () => {
    const server = fakeServer(() => "error");
    const tc = makeCase("Down", "https://x/", { postScript: `rr.test("never", () => {})` });
    const { results } = await run(suiteOf([tc]), server.send);
    expect(results[0].passed).toBe(false);
    expect(results[0].postScript).toBeUndefined();
    expect(results[0].checks[0]).toMatchObject({ name: "Response received", passed: false });
  });

  it("skips disabled cases", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const { results } = await run(suiteOf([makeCase("A", "https://x/a"), { ...makeCase("B", "https://x/b"), enabled: false }]), server.send);
    expect(results.map((r) => r.caseName)).toEqual(["A"]);
  });

  it("stops starting cases after a failure when asked", async () => {
    const server = fakeServer((req) => (req.url.endsWith("/b") ? { status: 500 } : { status: 200 }));
    const s = suiteOf([makeCase("A", "https://x/a"), makeCase("B", "https://x/b"), makeCase("C", "https://x/c")], { stopOnFailure: true });
    const { end, results } = await run(s, server.send);
    expect(end).toBe("stopped-on-failure");
    expect(results.map((r) => r.caseName)).toEqual(["A", "B"]);
  });

  it("runs one request at a time in sequential mode", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    await run(suiteOf([makeCase("A", "https://x/a"), makeCase("B", "https://x/b")], { mode: "sequential", concurrency: 5 }), server.send, [{}, {}, {}]);
    expect(server.maxInFlight()).toBe(1);
    expect(server.sent).toHaveLength(6);
  });

  it("runs iterations side by side, keeping each iteration's cases in order", async () => {
    const server = fakeServer(() => ({ status: 200 }), 10);
    const a = makeCase("A", "https://x/a/{{i}}", { postScript: `rr.vars.set("fromA", rr.data.i)` });
    const b = makeCase("B", "https://x/b/{{fromA}}");
    const rows = [{ i: "1" }, { i: "2" }, { i: "3" }, { i: "4" }];
    const { results } = await run(suiteOf([a, b], { mode: "parallel-iterations", concurrency: 2 }), server.send, rows);
    expect(server.maxInFlight()).toBe(2);
    expect(results).toHaveLength(8);
    for (const i of ["1", "2", "3", "4"]) {
      expect(server.sent.findIndex((s) => s.url === `https://x/a/${i}`)).toBeLessThan(server.sent.findIndex((s) => s.url === `https://x/b/${i}`));
    }
  });

  it("runs the cases of an iteration side by side in parallel-cases mode", async () => {
    const server = fakeServer(() => ({ status: 200 }), 10);
    const cases = ["A", "B", "C", "D"].map((n) => makeCase(n, `https://x/${n}`));
    await run(suiteOf(cases, { mode: "parallel-cases", concurrency: 3 }), server.send, [{}, {}]);
    expect(server.maxInFlight()).toBe(3);
    expect(server.sent).toHaveLength(8);
  });

  it("stops when cancelled and does not report the cut-off request", async () => {
    const server = fakeServer(() => ({ status: 200 }), 20);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const { end, results } = await run(suiteOf([makeCase("A", "https://x/a")], { repeat: 10 }), server.send, null, controller.signal);
    expect(end).toBe("cancelled");
    expect(results.length).toBeLessThan(10);
  });
});

describe("buildTestRun", () => {
  it("summarises results in plan order with per-case stats and a log", async () => {
    const server = fakeServer((req) => (req.url.endsWith("/b") ? { status: 500 } : { status: 200 }));
    const suite = suiteOf([makeCase("A", "https://x/a"), makeCase("B", "https://x/b")], { mode: "parallel-cases" });
    const { end, results } = await run(suite, server.send, [{ id: "1" }, { id: "2" }]);
    const t = buildTestRun({
      id: "r1",
      suite,
      csvName: "users.csv",
      columns: ["id"],
      iterations: 2,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      end,
      results: [...results].reverse(),
    });
    expect(t.results.map((r) => `${r.iteration}:${r.caseName}`)).toEqual(["0:A", "0:B", "1:A", "1:B"]);
    expect([t.plannedCases, t.completed, t.passed, t.failed]).toEqual([4, 4, 2, 2]);
    expect(caseStats(t).map((s) => [s.caseName, s.passed, s.failed])).toEqual([
      ["A", 2, 0],
      ["B", 0, 2],
    ]);
    expect(t.log.some((l) => l.message.startsWith('First failure: "B"'))).toBe(true);
    expect(t.log[t.log.length - 1].message).toMatch(/4 of 4 cases ran, 2 passed, 2 failed/);
  });
});

describe("request scripts in test runs", () => {
  it("runs the request's own scripts before the case's scripts", async () => {
    const server = fakeServer(() => ({ status: 200, body: '{"v":"1"}' }));
    const tc = makeCase("A", "https://{{host}}/x?a={{a}}&b={{b}}", {
      preScript: `const x = "case"; rr.vars.set("b", rr.vars.get("a") + "-" + x)`,
      postScript: `rr.test("case saw request var", () => rr.expect(rr.vars.get("fromRequest")).toBe("1"))`,
    });
    tc.request = { ...tc.request, preScript: `const x = "req"; rr.vars.set("a", x)`, postScript: `rr.vars.set("fromRequest", rr.response.json().v)` };
    const { results } = await run(suiteOf([tc]), server.send);
    expect(server.sent[0].url).toBe("https://api.test/x?a=req&b=req-case");
    expect(results[0].passed).toBe(true);
  });
});

describe("start variables", () => {
  it("starts every iteration from the given variables and reports each iteration's variables at the end", async () => {
    const server = fakeServer(() => ({ status: 200 }));
    const a = makeCase("A", "https://{{host}}/u/{{id}}?t={{token}}", { postScript: `rr.vars.set("seen", rr.data.id)` });
    const done: Record<string, string>[] = [];
    await runSuite(suiteOf([a]), {
      rows: [{ id: "1" }, { id: "2" }],
      envVars: { host: "api.test" },
      send: server.send,
      scripts: inlineScriptRunner,
      signal: new AbortController().signal,
      onResult: () => {},
      startVars: { token: "abc" },
      onIterationDone: (_i, vars) => done.push({ ...vars }),
    });
    expect(server.sent.map((s) => s.url)).toEqual(["https://api.test/u/1?t=abc", "https://api.test/u/2?t=abc"]);
    expect(done).toEqual([
      { token: "abc", seen: "1" },
      { token: "abc", seen: "2" },
    ]);
  });
});
