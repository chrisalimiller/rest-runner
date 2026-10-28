import { describe, expect, it } from "vitest";
import { executeScript, type ScriptContext } from "./sandbox";

const ctx: ScriptContext = {
  phase: "post",
  vars: { existing: "1" },
  data: { userId: "7" },
  env: { baseUrl: "https://api.test", userId: "env-user" },
  iteration: 0,
  caseName: "Get user",
  request: { method: "GET", url: "https://api.test/users/7", headers: [] },
  response: {
    status: 200,
    statusText: "OK",
    headers: [["Content-Type", "application/json"]],
    body: '{"id":7,"token":"t-1","roles":["admin"]}',
    durationMs: 50,
    sizeBytes: 40,
  },
};

describe("executeScript", () => {
  it("records passing and failing tests with messages", () => {
    const out = executeScript(
      `rr.test("status 200", () => rr.expect(rr.response.status).toBe(200));
       rr.test("is admin", () => rr.expect(rr.response.json().roles).toContain("admin"));
       rr.test("wrong id", () => rr.expect(rr.response.json().id).toBe(8));
       rr.test("not empty", () => rr.expect(rr.response.body).not.toBe(""));`,
      ctx,
    );
    expect(out.error).toBeUndefined();
    expect(out.tests.map((t) => t.passed)).toEqual([true, true, false, true]);
    expect(out.tests[2].error).toBe("Expected 7 to be 8");
  });

  it("sets and reads variables with run vars over CSV over environment", () => {
    const out = executeScript(
      `rr.vars.set("token", rr.response.json().token);
       rr.vars.set("count", 3);
       rr.vars.unset("existing");
       rr.log("user", rr.vars.get("userId"), rr.vars.get("baseUrl"));`,
      ctx,
    );
    expect(out.vars).toEqual({ token: "t-1", count: "3" });
    expect(out.logs).toEqual(["user 7 https://api.test"]);
  });

  it("does not change the context it was given", () => {
    executeScript(`rr.vars.set("x", "y")`, ctx);
    expect(ctx.vars).toEqual({ existing: "1" });
  });

  it("reports a thrown error and keeps tests recorded before it", () => {
    const out = executeScript(`rr.test("first", () => {}); undefinedThing.call();`, ctx);
    expect(out.tests).toHaveLength(1);
    expect(out.error).toMatch(/ReferenceError/);
  });

  it("reports a syntax error", () => {
    expect(executeScript(`rr.test("x", () => {`, ctx).error).toMatch(/SyntaxError/);
  });

  it("captures console.log and reads headers by any case", () => {
    const out = executeScript(`console.log(rr.response.header("content-type"), {a: 1})`, ctx);
    expect(out.logs).toEqual(['application/json {"a":1}']);
  });

  it("treats an async test as a failure", () => {
    const out = executeScript(`rr.test("later", async () => {})`, ctx);
    expect(out.tests[0]).toMatchObject({ passed: false, error: "rr.test functions cannot be async" });
  });

  it("fails a test whose second argument is not a function, with a clear message", () => {
    const out = executeScript(`rr.test("bool", rr.response.status === 200)`, ctx);
    expect(out.tests[0]).toMatchObject({ passed: false });
    expect(out.tests[0].error).toMatch(/needs a function/);
  });
});

describe("executeScript Postman guard", () => {
  it("refuses a script that still uses pm.* and runs nothing", () => {
    const out = executeScript(`console.log("before"); pm.test("a", () => {}); pm.sendRequest("u");`, ctx);
    expect(out.error).toMatch(/still uses Postman pm\.\* calls \(pm\.test, pm\.sendRequest\)/);
    expect(out.error).toMatch(/Scripts tab/);
    expect(out.logs).toEqual([]);
    expect(out.tests).toEqual([]);
  });

  it("does not trip on pm in comments or strings", () => {
    const out = executeScript(`// pm.test("a")\nrr.log("pm.response.json()");`, ctx);
    expect(out.error).toBeUndefined();
    expect(out.logs).toEqual(["pm.response.json()"]);
  });
});

