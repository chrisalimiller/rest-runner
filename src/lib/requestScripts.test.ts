import { describe, expect, it } from "vitest";
import { runBatch, type BatchItemResult, type SendFn } from "./batch";
import { newRequest } from "./defaults";
import { toCsvReport, toHtmlReport } from "./report";
import { combineScripts, hasScripts, sendWithScripts } from "./requestScripts";
import { buildRun } from "./run";
import { inlineScriptRunner } from "./testing/scriptRunner";
import type { PreparedRequest, RequestDef, SendOutcome } from "./types";

function fakeServer(body = "{}", status = 200) {
  const sent: PreparedRequest[] = [];
  const send: SendFn = async (req) => {
    sent.push(req);
    return {
      ok: true,
      request: req,
      sentAt: new Date().toISOString(),
      response: { status, statusText: "", headers: [["content-type", "application/json"]], body, sizeBytes: body.length, durationMs: 3 },
    } satisfies SendOutcome;
  };
  return { send, sent };
}

function req(extra: Partial<RequestDef>): RequestDef {
  return { ...newRequest(), url: "https://{{host}}/items", ...extra };
}

const base = { env: { host: "api.test" }, data: {}, vars: {}, iteration: 0, scripts: inlineScriptRunner };

describe("sendWithScripts", () => {
  it("fills placeholders from variables the pre-request script sets", async () => {
    const server = fakeServer();
    const def = req({ url: "https://{{host}}/items/{{id}}", preScript: `rr.vars.set("id", "42"); console.log("pre ran")` });
    const r = await sendWithScripts({ ...base, def, send: server.send });
    expect(server.sent[0].url).toBe("https://api.test/items/42");
    expect(r?.sent).toBe(true);
    expect(r?.preScript?.logs).toEqual(["pre ran"]);
    expect(r?.vars).toEqual({ id: "42" });
    expect(r?.scriptFailed).toBe(false);
  });

  it("does not send when the pre-request script throws", async () => {
    const server = fakeServer();
    const def = req({ preScript: `throw new Error("nope")` });
    const r = await sendWithScripts({ ...base, def, send: server.send });
    expect(server.sent).toHaveLength(0);
    expect(r?.sent).toBe(false);
    expect(r?.outcome.ok).toBe(false);
    const o = r!.outcome;
    expect(o.ok ? "" : o.error).toMatch(/pre-request script failed.*nope/);
    expect(r?.scriptFailed).toBe(true);
  });

  it("gives the post-response script the response and keeps the variables it sets", async () => {
    const server = fakeServer('{"token":"abc"}');
    const def = req({
      postScript: `rr.vars.set("token", rr.response.json().token);
rr.test("is 200", () => rr.expect(rr.response.status).toBe(200));
rr.test("is 201", () => rr.expect(rr.response.status).toBe(201));`,
    });
    const r = await sendWithScripts({ ...base, def, vars: { keep: "1" }, send: server.send });
    expect(r?.vars).toEqual({ keep: "1", token: "abc" });
    expect(r?.postScript?.tests.map((t) => t.passed)).toEqual([true, false]);
    expect(r?.scriptFailed).toBe(true);
  });

  it("behaves like a plain send when the request has no scripts", async () => {
    const server = fakeServer();
    const def = req({});
    expect(hasScripts(def)).toBe(false);
    const r = await sendWithScripts({ ...base, def, send: server.send });
    expect(r?.preScript).toBeUndefined();
    expect(r?.postScript).toBeUndefined();
    expect(server.sent[0].url).toBe("https://api.test/items");
  });
});

describe("combineScripts", () => {
  it("runs both parts in their own blocks so names do not clash", () => {
    expect(combineScripts("", "b()")).toBe("b()");
    expect(combineScripts("a()", undefined)).toBe("a()");
    const both = combineScripts("const x = 1;", "const x = 2;");
    expect(() => new Function(both)).not.toThrow();
  });
});

describe("batch runs with scripts", () => {
  const opts = { concurrency: 2, delayMs: 0, stopOnFailure: false, httpErrorsFail: true };

  it("runs the scripts once per row, each row with its own copy of the variables", async () => {
    const server = fakeServer();
    const def = req({
      url: "https://{{host}}/u/{{id}}?n={{n}}",
      preScript: `rr.vars.set("n", rr.data.id + "-" + rr.iteration); rr.vars.set("count", Number(rr.vars.get("count") || 0) + 1)`,
      postScript: `rr.test("ok", () => rr.expect(rr.data.id).not.toBe("2"))`,
    });
    const results: BatchItemResult[] = [];
    await runBatch(def, [{ id: "1" }, { id: "2" }, { id: "3" }], opts, server.send, (r) => results.push(r), new AbortController().signal, { host: "api.test" }, {
      runner: inlineScriptRunner,
      vars: { count: "10", id: "999" },
    });
    expect(server.sent.map((s) => s.url).sort()).toEqual(["https://api.test/u/1?n=1-0", "https://api.test/u/2?n=2-1", "https://api.test/u/3?n=3-2"]);
    const sorted = [...results].sort((a, b) => a.index - b.index);
    expect(sorted.map((r) => r.scriptVars?.count)).toEqual(["11", "11", "11"]);
    expect(sorted.map((r) => r.failed)).toEqual([false, true, false]);

    const run = buildRun({
      id: "r",
      request: def,
      csvName: "rows.csv",
      columns: ["id"],
      totalRows: 3,
      options: opts,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      end: "completed",
      results,
      missingPlaceholders: [],
    });
    expect(run.entries[1].notes.join(" ")).toMatch(/1 of 1 script tests failed: ok/);
    expect(run.log.some((l) => /scripts ran for each row/.test(l.message))).toBe(true);
    expect(run.log.some((l) => /failing tests on 1 row/.test(l.message))).toBe(true);
    const csv = toCsvReport(run);
    expect(csv.split("\r\n")[0]).toContain("script_tests,script_log");
    expect(csv).toContain("FAIL ok");
    expect(toHtmlReport(run)).toContain("Post-response script");
  });

  it("marks a row not sent when its pre-request script fails", async () => {
    const server = fakeServer();
    const def = req({ preScript: `if (rr.data.id === "2") throw new Error("bad row")` });
    const results: BatchItemResult[] = [];
    await runBatch(def, [{ id: "1" }, { id: "2" }], opts, server.send, (r) => results.push(r), new AbortController().signal, { host: "api.test" }, {
      runner: inlineScriptRunner,
    });
    expect(server.sent).toHaveLength(1);
    const bad = results.find((r) => r.index === 1)!;
    expect(bad.sent).toBe(false);
    expect(bad.failed).toBe(true);
    const run = buildRun({
      id: "r",
      request: def,
      csvName: "rows.csv",
      columns: ["id"],
      totalRows: 2,
      options: opts,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      end: "completed",
      results,
      missingPlaceholders: [],
    });
    expect(run.entries[1].notes).toEqual(["Pre-request script failed, so the request was not sent: bad row"]);
  });
});
