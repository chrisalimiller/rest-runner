import { describe, expect, it } from "vitest";
import { evaluateAssertion } from "./assertions";
import { readPath } from "./jsonPath";
import { newAssertion } from "./suites";
import type { ResponseResult } from "../types";

const res: ResponseResult = {
  status: 201,
  statusText: "Created",
  headers: [
    ["content-type", "application/json; charset=utf-8"],
    ["x-request-id", "abc-123"],
  ],
  body: JSON.stringify({ id: 42, name: "Ada", tags: ["a", "b"], nested: { ok: true, n: null }, "odd key": 1 }),
  sizeBytes: 90,
  durationMs: 120,
};

const check = (p: Parameters<typeof newAssertion>[0], vars = {}) => evaluateAssertion(newAssertion(p), res, vars);

describe("readPath", () => {
  it("reads dotted, indexed, quoted and length paths", () => {
    const v = JSON.parse(res.body);
    expect(readPath(v, "$.id")).toBe(42);
    expect(readPath(v, "tags[1]")).toBe("b");
    expect(readPath(v, "$.tags[-1]")).toBe("b");
    expect(readPath(v, '$["odd key"]')).toBe(1);
    expect(readPath(v, "$.tags.length")).toBe(2);
    expect(readPath(v, "$.nested.n")).toBeNull();
    expect(readPath(v, "$.missing.deeper")).toBeUndefined();
    expect(readPath(v, "$")).toEqual(v);
  });
});

describe("evaluateAssertion", () => {
  it("checks status by exact code and by class", () => {
    expect(check({ source: "status", op: "eq", expected: "201" }).passed).toBe(true);
    expect(check({ source: "status", op: "eq", expected: "2xx" }).passed).toBe(true);
    expect(check({ source: "status", op: "eq", expected: "200" }).passed).toBe(false);
    expect(check({ source: "status", op: "neq", expected: "4xx" }).passed).toBe(true);
  });

  it("compares response time and reports non-numbers", () => {
    expect(check({ source: "time", op: "lt", expected: "500" }).passed).toBe(true);
    expect(check({ source: "time", op: "lt", expected: "100" }).passed).toBe(false);
    const bad = check({ source: "time", op: "lt", expected: "fast" });
    expect(bad.passed).toBe(false);
    expect(bad.message).toMatch(/not a number/);
  });

  it("reads headers case-insensitively", () => {
    expect(check({ source: "header", property: "Content-Type", op: "contains", expected: "json" }).passed).toBe(true);
    expect(check({ source: "header", property: "X-Missing", op: "notExists", expected: "" }).passed).toBe(true);
    expect(check({ source: "header", property: "x-request-id", op: "matches", expected: "^abc-\\d+$" }).passed).toBe(true);
  });

  it("checks JSON values loosely and by type", () => {
    expect(check({ source: "json", property: "$.id", op: "eq", expected: "42" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.name", op: "eq", expected: "Ada" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.nested.ok", op: "eq", expected: "true" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.tags", op: "eq", expected: '["a","b"]' }).passed).toBe(true);
    expect(check({ source: "json", property: "$.tags", op: "contains", expected: "a" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.nested", op: "contains", expected: "ok" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.id", op: "gte", expected: "40" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.tags", op: "isType", expected: "array" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.nested.n", op: "exists", expected: "" }).passed).toBe(true);
    expect(check({ source: "json", property: "$.nope", op: "exists", expected: "" }).passed).toBe(false);
  });

  it("fills placeholders in the expected value", () => {
    const c = check({ source: "json", property: "$.name", op: "eq", expected: "{{name}}" }, { name: "Ada" });
    expect(c.passed).toBe(true);
    expect(c.name).toBe("JSON path $.name equals Ada");
  });

  it("fails clearly when the body is not JSON", () => {
    const c = evaluateAssertion(newAssertion({ source: "json", property: "$.id", op: "exists" }), { ...res, body: "<html>" });
    expect(c.passed).toBe(false);
    expect(c.message).toBe("Response body is not JSON");
  });

  it("checks the body text", () => {
    expect(check({ source: "body", op: "contains", expected: '"Ada"' }).passed).toBe(true);
    expect(check({ source: "body", op: "notContains", expected: "error" }).passed).toBe(true);
  });
});
