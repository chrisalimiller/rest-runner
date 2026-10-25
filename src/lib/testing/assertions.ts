import { applyTemplate, type Vars } from "../template";
import type { ResponseResult } from "../types";
import { readPath } from "./jsonPath";
import type { Assertion, AssertionOp, AssertionSource, Check } from "./types";

export const SOURCE_LABELS: Record<AssertionSource, string> = {
  status: "Status code",
  time: "Response time (ms)",
  size: "Response size (bytes)",
  header: "Header",
  body: "Body",
  json: "JSON path",
};

export const OP_LABELS: Record<AssertionOp, string> = {
  eq: "equals",
  neq: "does not equal",
  lt: "is less than",
  lte: "is at most",
  gt: "is greater than",
  gte: "is at least",
  contains: "contains",
  notContains: "does not contain",
  exists: "exists",
  notExists: "does not exist",
  matches: "matches regex",
  isType: "is of type",
};

/** Ops that make sense for each source, in the order the editor offers them. */
export const OPS_FOR_SOURCE: Record<AssertionSource, AssertionOp[]> = {
  status: ["eq", "neq", "lt", "lte", "gt", "gte"],
  time: ["lt", "lte", "gt", "gte"],
  size: ["lt", "lte", "gt", "gte", "eq"],
  header: ["eq", "neq", "contains", "notContains", "exists", "notExists", "matches"],
  body: ["contains", "notContains", "eq", "matches"],
  json: ["eq", "neq", "contains", "notContains", "exists", "notExists", "lt", "lte", "gt", "gte", "matches", "isType"],
};

export function opNeedsValue(op: AssertionOp): boolean {
  return op !== "exists" && op !== "notExists";
}

export { show as showValue, typeOf as typeOfValue };

export function describeAssertion(a: Assertion): string {
  const subject = a.source === "header" || a.source === "json" ? `${SOURCE_LABELS[a.source]} ${a.property}` : SOURCE_LABELS[a.source];
  return opNeedsValue(a.op) ? `${subject} ${OP_LABELS[a.op]} ${a.expected}` : `${subject} ${OP_LABELS[a.op]}`;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function show(v: unknown): string {
  if (v === undefined) return "(missing)";
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The expected text as a JSON value when it parses as one, otherwise as plain text. */
function parseExpected(expected: string): unknown {
  try {
    return JSON.parse(expected);
  } catch {
    return expected;
  }
}

/** Equality that lets "42" match 42 and "true" match true, and compares objects and arrays by value. */
function looseEqual(actual: unknown, expected: string): boolean {
  if (typeof actual === "string") return actual === expected;
  return deepEqual(actual, parseExpected(expected));
}

/** Status equals 2xx / 4xx style classes. */
function statusClassMatch(actual: unknown, expected: string): boolean | null {
  const m = /^([1-5])xx$/i.exec(expected.trim());
  if (!m || typeof actual !== "number") return null;
  return Math.floor(actual / 100) === Number(m[1]);
}

function contains(actual: unknown, expected: string): boolean {
  if (typeof actual === "string") return actual.includes(expected);
  if (Array.isArray(actual)) {
    const want = parseExpected(expected);
    return actual.some((x) => deepEqual(x, want) || (typeof x !== "object" && String(x) === expected));
  }
  if (actual && typeof actual === "object") return Object.prototype.hasOwnProperty.call(actual, expected);
  return actual !== undefined && String(actual).includes(expected);
}

function compareNumbers(actual: unknown, expected: string, op: "lt" | "lte" | "gt" | "gte"): boolean | string {
  const a = typeof actual === "number" ? actual : typeof actual === "string" && actual.trim() !== "" ? Number(actual) : NaN;
  const b = Number(expected);
  if (Number.isNaN(b)) return `"${expected}" is not a number`;
  if (Number.isNaN(a)) return `${show(actual)} is not a number`;
  if (op === "lt") return a < b;
  if (op === "lte") return a <= b;
  if (op === "gt") return a > b;
  return a >= b;
}

function header(res: ResponseResult, name: string): string | undefined {
  const lower = name.trim().toLowerCase();
  const values = res.headers.filter(([k]) => k.toLowerCase() === lower).map(([, v]) => v);
  return values.length ? values.join(", ") : undefined;
}

type Actual = { value: unknown } | { error: string };

function actualValue(a: Assertion, res: ResponseResult): Actual {
  switch (a.source) {
    case "status":
      return { value: res.status };
    case "time":
      return { value: res.durationMs };
    case "size":
      return { value: res.sizeBytes };
    case "header":
      return { value: header(res, a.property) };
    case "body":
      return { value: res.body };
    case "json": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        return { error: "Response body is not JSON" };
      }
      try {
        return { value: readPath(parsed, a.property || "$") };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
}

/**
 * Compares a value against the expected text with one of the assertion ops.
 * Returns true or false, or a message when the comparison cannot be made.
 */
export function compareValue(op: AssertionOp, actual: unknown, expected: string): boolean | string {
  let result: boolean | string;
  switch (op) {
    case "eq":
      result = statusClassMatch(actual, expected) ?? looseEqual(actual, expected);
      break;
    case "neq":
      result = !(statusClassMatch(actual, expected) ?? looseEqual(actual, expected));
      break;
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      result = compareNumbers(actual, expected, op);
      break;
    case "contains":
      result = contains(actual, expected);
      break;
    case "notContains":
      result = actual !== undefined && !contains(actual, expected);
      break;
    case "exists":
      result = actual !== undefined;
      break;
    case "notExists":
      result = actual === undefined;
      break;
    case "matches":
      try {
        result = actual !== undefined && new RegExp(expected).test(typeof actual === "string" ? actual : JSON.stringify(actual));
      } catch {
        result = `"${expected}" is not a valid regular expression`;
      }
      break;
    case "isType":
      result = typeOf(actual) === expected.trim().toLowerCase();
      break;
  }

  return result;
}

/** Checks one assertion against a response. Placeholders in the expected value are filled from vars. */
export function evaluateAssertion(a: Assertion, res: ResponseResult, vars: Vars = {}): Check {
  const filled = { ...a, expected: applyTemplate(a.expected, vars), property: applyTemplate(a.property, vars) };
  const name = describeAssertion(filled);
  const got = actualValue(filled, res);
  if ("error" in got) return { name, passed: false, message: got.error, source: "assertion" };
  const actual = got.value;
  const expected = filled.expected;

  const result = compareValue(a.op, actual, expected);
  if (typeof result === "string") return { name, passed: false, message: result, source: "assertion" };
  const seen = a.op === "isType" ? `${show(actual)} (${typeOf(actual)})` : show(actual);
  return { name, passed: result, message: `Got ${seen}`, source: "assertion" };
}
