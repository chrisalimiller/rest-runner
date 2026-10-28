import { describe, expect, it } from "vitest";
import { convertPostmanScript, findPostmanCalls, postmanApiNames, usesPostman } from "./postmanScripts";
import { RR_COMPLETIONS } from "./testing/snippets";

const conv = (code: string) => convertPostmanScript(code);

const CASES: [string, string][] = [
  // variables
  ['pm.variables.get("a")', 'rr.vars.get("a")'],
  ['pm.environment.get("a")', 'rr.vars.get("a")'],
  ['pm.collectionVariables.get("a")', 'rr.vars.get("a")'],
  ['pm.globals.get("a")', 'rr.vars.get("a")'],
  ['pm.iterationData.get("a")', 'rr.data["a"]'],
  ['pm.variables.set("a", 1)', 'rr.vars.set("a", 1)'],
  ['pm.environment.set("a", x + 1)', 'rr.vars.set("a", x + 1)'],
  ['pm.globals.unset("a")', 'rr.vars.unset("a")'],
  ['pm.environment.has("a")', 'rr.vars.has("a")'],
  ["pm.environment.toObject()", "rr.vars.all()"],
  ['postman.getEnvironmentVariable("a")', 'rr.vars.get("a")'],
  ['postman.getGlobalVariable("a")', 'rr.vars.get("a")'],
  ['postman.setEnvironmentVariable("a", 1)', 'rr.vars.set("a", 1)'],
  ['postman.setGlobalVariable("a", 1)', 'rr.vars.set("a", 1)'],
  ['environment["a"]', 'rr.vars.get("a")'],
  ['globals["a"]', 'rr.vars.get("a")'],
  ['data["a"]', 'rr.data["a"]'],
  ["data.name", "rr.data.name"],
  // response, request, info
  ["pm.response.code", "rr.response.status"],
  ["responseCode.code", "rr.response.status"],
  ["pm.response.status", "rr.response.statusText"],
  ["pm.response.json()", "rr.response.json()"],
  ["pm.response.json().id", "rr.response.json().id"],
  ["pm.response.text()", "rr.response.text()"],
  ["responseBody", "rr.response.text()"],
  ["pm.response.responseTime", "rr.response.time"],
  ["responseTime", "rr.response.time"],
  ["pm.response.size()", "rr.response.size"],
  ["pm.response.size().body", "rr.response.size"],
  ['pm.response.headers.get("X")', 'rr.response.header("X")'],
  ['postman.getResponseHeader("X")', 'rr.response.header("X")'],
  ['responseHeaders["X"]', 'rr.response.header("X")'],
  ['pm.response.headers.has("X")', '(rr.response.header("X") !== undefined)'],
  ["pm.request.url", "rr.request.url"],
  ["pm.request.url.toString()", "rr.request.url"],
  ["pm.request.method", "rr.request.method"],
  ['pm.request.headers.get("X")', 'rr.request.header("X")'],
  ["pm.request.body.raw", "rr.request.body"],
  ["pm.info.iteration", "rr.iteration"],
  ["iteration", "rr.iteration"],
  ["pm.info.requestName", "rr.caseName"],
  // tests
  ['pm.test("t", () => {})', 'rr.test("t", () => {})'],
  ['tests["ok"] = a > 1;', 'rr.test("ok", () => rr.expect(a > 1).toBeTruthy());'],
  ["pm.response.to.have.status(200)", "rr.expect(rr.response.status).toBe(200)"],
  ["pm.response.to.be.ok", "rr.expect(rr.response.status >= 200 && rr.response.status < 300).toBe(true)"],
  ["pm.response.to.be.success", "rr.expect(rr.response.status >= 200 && rr.response.status < 300).toBe(true)"],
  ['pm.response.to.have.header("X")', 'rr.expect(rr.response.header("X")).toBeDefined()'],
  ["pm.response.to.have.jsonBody()", "rr.response.json()"],
  ["pm.response.to.be.json", "rr.response.json()"],
  ["pm.expect(a).to.equal(b)", "rr.expect(a).toBe(b)"],
  ["pm.expect(a).to.eq(b)", "rr.expect(a).toBe(b)"],
  ["pm.expect(a).to.be.equal(b)", "rr.expect(a).toBe(b)"],
  ["pm.expect(a).to.eql(b)", "rr.expect(a).toEqual(b)"],
  ["pm.expect(a).to.deep.equal(b)", "rr.expect(a).toEqual(b)"],
  ["pm.expect(a).to.be.true", "rr.expect(a).toBe(true)"],
  ["pm.expect(a).to.be.false", "rr.expect(a).toBe(false)"],
  ["pm.expect(a).to.be.null", "rr.expect(a).toBeNull()"],
  ["pm.expect(a).to.be.undefined", "rr.expect(a).toBe(undefined)"],
  ["pm.expect(a).to.be.ok", "rr.expect(a).toBeTruthy()"],
  ["pm.expect(a).to.exist", "rr.expect(a).toBeDefined()"],
  ["pm.expect(a).to.include(b)", "rr.expect(a).toContain(b)"],
  ["pm.expect(a).to.contain(b)", "rr.expect(a).toContain(b)"],
  ["pm.expect(a).to.be.above(1)", "rr.expect(a).toBeGreaterThan(1)"],
  ["pm.expect(a).to.be.gt(1)", "rr.expect(a).toBeGreaterThan(1)"],
  ["pm.expect(a).to.be.least(1)", "rr.expect(a).toBeGreaterThanOrEqual(1)"],
  ["pm.expect(a).to.be.below(1)", "rr.expect(a).toBeLessThan(1)"],
  ["pm.expect(a).to.be.lt(1)", "rr.expect(a).toBeLessThan(1)"],
  ["pm.expect(a).to.be.most(1)", "rr.expect(a).toBeLessThanOrEqual(1)"],
  ['pm.expect(a).to.have.property("x")', 'rr.expect(a).toHaveProperty("x")'],
  ["pm.expect(a).to.have.lengthOf(2)", "rr.expect(a).toHaveLength(2)"],
  ["pm.expect(a).to.match(/x/)", "rr.expect(a).toMatch(/x/)"],
  ["pm.expect(a).to.not.equal(b)", "rr.expect(a).not.toBe(b)"],
  ["pm.expect(a).not.to.be.null", "rr.expect(a).not.toBeNull()"],
  ['pm.expect(a).to.be.a("string")', 'rr.expect(typeof a).toBe("string")'],
  ['pm.expect(a.b).to.be.an("object")', 'rr.expect(typeof a.b).toBe("object")'],
  ['pm.expect(f(1)).to.be.a("number")', 'rr.expect(typeof (f(1))).toBe("number")'],
  ['pm.expect(a).to.be.an("array")', "rr.expect(Array.isArray(a)).toBe(true)"],
  ['pm.expect(a).not.to.be.an("array")', "rr.expect(Array.isArray(a)).not.toBe(true)"],
];

describe("convertPostmanScript", () => {
  it.each(CASES)("%s", (input, expected) => {
    const out = conv(input);
    expect(out.code).toBe(expected);
    expect(out.remaining).toEqual([]);
    expect(out.converted).toBeGreaterThan(0);
  });

  it("converts nested calls over several passes", () => {
    const out = conv("pm.expect(pm.response.code).to.eql(200);");
    expect(out.code).toBe("rr.expect(rr.response.status).toEqual(200);");
    expect(out.remaining).toEqual([]);
  });

  it("converts a realistic script", () => {
    const out = conv(`pm.test("ok", function () {
  pm.response.to.have.status(200);
  const body = pm.response.json();
  pm.expect(body.items).to.have.lengthOf(3);
  pm.environment.set("id", body.id);
});`);
    expect(out.code).toBe(`rr.test("ok", function () {
  rr.expect(rr.response.status).toBe(200);
  const body = rr.response.json();
  rr.expect(body.items).toHaveLength(3);
  rr.vars.set("id", body.id);
});`);
  });

  it("is idempotent and leaves nothing behind", () => {
    const once = conv('pm.test("a", () => { pm.expect(pm.response.code).to.equal(200); });');
    const twice = conv(once.code);
    expect(twice.code).toBe(once.code);
    expect(twice.converted).toBe(0);
    expect(usesPostman(once.code)).toBe(false);
  });
});

describe("findPostmanCalls", () => {
  it("ignores pm in comments, strings and template literals", () => {
    expect(findPostmanCalls('// pm.test("x")\n/* pm.response.json() */\nconst s = "pm.environment.get(1)"; const t = `pm.test`;')).toEqual([]);
  });

  it("does not flag names the script declares itself", () => {
    expect(findPostmanCalls("const data = {}; data.x = 1; function f(iteration) { return iteration; }")).toEqual([]);
    expect(findPostmanCalls("const pm = {}; pm.test('a')")).toEqual([]);
  });

  it("does not flag rr scripts or unrelated members", () => {
    expect(findPostmanCalls('rr.test("a", () => rr.expect(obj.data).toBe(1)); const o = { data: 1, tests: 2 };')).toEqual([]);
  });

  it("leaves unknown chai words untouched and flagged", () => {
    const code = "pm.expect(a).to.be.oneOf([1, 2]);";
    const out = conv(code);
    expect(out.code).toBe(code);
    expect(out.remaining).toHaveLength(1);
    expect(out.remaining[0].fix).toBeUndefined();
  });

  it("flags pm.* without an rr equivalent, with advice", () => {
    const cases: [string, RegExp][] = [
      ['pm.sendRequest("u", () => {})', /Flow/],
      ['pm.request.headers.add({ key: "a", value: "b" })', /rr\.vars\.set/],
      ["pm.execution.setNextRequest('x')", /Flow/],
      ['postman.setNextRequest("x")', /Flow/],
      ['pm.cookies.get("a")', /set-cookie/],
      ["pm.visualizer.set('t')", /console\.log/],
      ["pm.response.to.have.jsonSchema(s)", /schema/i],
      ['pm.environment.replaceIn("{{a}}")', /\{\{name\}\}/],
      ["pm.somethingNew.x()", /no REST Runner equivalent/],
      ['require("lodash")', /libraries/],
      ["_.map(a, f)", /libraries/],
    ];
    for (const [code, msg] of cases) {
      const found = findPostmanCalls(code);
      expect(found.length, code).toBeGreaterThan(0);
      expect(found[0].fix, code).toBeUndefined();
      expect(found[0].message, code).toMatch(msg);
    }
  });

  it("finds calls inside the arguments of an unconvertible call", () => {
    const out = conv('pm.sendRequest("u", () => { pm.environment.set("a", 1); });');
    expect(out.code).toBe('pm.sendRequest("u", () => { rr.vars.set("a", 1); });');
    expect(out.remaining.map((c) => c.api)).toEqual(["pm.sendRequest"]);
  });

  it("copes with unfinished chains while typing", () => {
    for (const code of ["pm", "pm.response", "pm.response.to", "pm.expect(a).to", "pm.environment", "postman", "pm.info", "pm.request.headers"]) {
      expect(() => findPostmanCalls(code), code).not.toThrow();
      expect(findPostmanCalls(code).length, code).toBeGreaterThan(0);
    }
  });

  it("reports ranges that cover the matched text", () => {
    const code = 'const x = pm.response.json().id;';
    const [c] = findPostmanCalls(code);
    expect(code.slice(c.from, c.to)).toBe("pm.response.json()");
  });

  it("adds a note to environment writes", () => {
    expect(findPostmanCalls('pm.environment.set("a", 1)')[0].message).toMatch(/does not change the saved environment/);
  });
});

describe("usesPostman", () => {
  it("is true for pm calls and false for plain scripts", () => {
    expect(usesPostman("pm.test('a', () => {})")).toBe(true);
    expect(usesPostman('rr.test("a", () => {})')).toBe(false);
    expect(usesPostman("")).toBe(false);
  });

  it("stays strict on scripts with syntax errors", () => {
    expect(usesPostman("const a = ;\npm.test(")).toBe(true);
    expect(usesPostman("const a = ;\n// pm.test(\nrr.log(")).toBe(false);
  });

  it("lists at most three distinct api names", () => {
    const names = postmanApiNames("pm.test('a'); pm.test('b'); pm.response.json(); pm.sendRequest(); pm.cookies.get('x');");
    expect(names).toEqual(["pm.test", "pm.response.json", "pm.sendRequest"]);
  });
});

describe("mapping table", () => {
  it("only uses rr members that exist", () => {
    const labels = RR_COMPLETIONS.map((c) => c.label);
    for (const [, expected] of CASES) {
      for (const path of expected.match(/rr\.[A-Za-z]+(\.[A-Za-z]+)?/g) ?? []) {
        const ok = labels.some((l) => path === l || path.startsWith(l + "."));
        expect(ok, `${path} in ${expected}`).toBe(true);
      }
    }
  });
});
