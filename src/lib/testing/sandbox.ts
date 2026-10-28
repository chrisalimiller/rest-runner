import { postmanApiNames, usesPostman } from "../postmanScripts";
import type { Vars } from "../template";
import type { ScriptOutput } from "./types";

/** Everything a script can see. It is plain data so it can be sent to a Web Worker. */
export interface ScriptContext {
  phase: "pre" | "post";
  /** Run variables. Scripts can change these and later cases see the changes. */
  vars: Vars;
  /** The CSV row for this iteration (read-only). */
  data: Vars;
  /** Environment variables (read-only). */
  env: Vars;
  iteration: number;
  caseName: string;
  request: { method: string; url: string; headers: [string, string][]; body?: string };
  response?: { status: number; statusText: string; headers: [string, string][]; body: string; durationMs: number; sizeBytes: number };
}

function show(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** A small expect() in the style of Jest. Every matcher also works after .not. */
function makeExpect(actual: unknown, negate = false) {
  const check = (ok: boolean, message: string) => {
    if (ok === negate) fail(negate ? `Expected not: ${message}` : `Expected ${message}`);
  };
  const m = {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `${show(actual)} to be ${show(expected)}`),
    toEqual: (expected: unknown) => check(deepEqual(actual, expected), `${show(actual)} to equal ${show(expected)}`),
    toBeTruthy: () => check(!!actual, `${show(actual)} to be truthy`),
    toBeFalsy: () => check(!actual, `${show(actual)} to be falsy`),
    toBeDefined: () => check(actual !== undefined, `value to be defined`),
    toBeUndefined: () => check(actual === undefined, `${show(actual)} to be undefined`),
    toBeNull: () => check(actual === null, `${show(actual)} to be null`),
    toBeGreaterThan: (n: number) => check(typeof actual === "number" && actual > n, `${show(actual)} to be greater than ${n}`),
    toBeGreaterThanOrEqual: (n: number) => check(typeof actual === "number" && actual >= n, `${show(actual)} to be at least ${n}`),
    toBeLessThan: (n: number) => check(typeof actual === "number" && actual < n, `${show(actual)} to be less than ${n}`),
    toBeLessThanOrEqual: (n: number) => check(typeof actual === "number" && actual <= n, `${show(actual)} to be at most ${n}`),
    toContain: (item: unknown) =>
      check(
        typeof actual === "string" ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((x) => deepEqual(x, item)),
        `${show(actual)} to contain ${show(item)}`,
      ),
    toMatch: (re: RegExp | string) =>
      check(typeof actual === "string" && (typeof re === "string" ? new RegExp(re) : re).test(actual), `${show(actual)} to match ${String(re)}`),
    toHaveProperty: (key: string) =>
      check(!!actual && typeof actual === "object" && Object.prototype.hasOwnProperty.call(actual, key), `${show(actual)} to have property "${key}"`),
    toHaveLength: (n: number) =>
      check((Array.isArray(actual) || typeof actual === "string") && actual.length === n, `${show(actual)} to have length ${n}`),
  };
  return m;
}

function expect(actual: unknown) {
  return { ...makeExpect(actual), not: makeExpect(actual, true) };
}

/**
 * Runs a script synchronously and reports what it did. The script gets `rr` and `console`.
 * This does not enforce a time limit; scriptRunner.ts runs it in a Worker for that.
 */
export function executeScript(code: string, ctx: ScriptContext): ScriptOutput {
  const start = Date.now();
  const vars: Vars = { ...ctx.vars };
  const tests: ScriptOutput["tests"] = [];
  const logs: string[] = [];
  const log = (...args: unknown[]) => logs.push(args.map(show).join(" "));

  const res = ctx.response;
  const lookupHeader = (headers: [string, string][], name: string) => {
    const lower = name.toLowerCase();
    const found = headers.filter(([k]) => k.toLowerCase() === lower).map(([, v]) => v);
    return found.length ? found.join(", ") : undefined;
  };
  let parsedJson: { value: unknown } | null = null;

  const rr = {
    vars: {
      /** Looks in run variables, then the CSV row, then the environment. */
      get: (name: string) => (name in vars ? vars[name] : name in ctx.data ? ctx.data[name] : ctx.env[name]),
      set: (name: string, value: unknown) => {
        vars[String(name)] = typeof value === "string" ? value : show(value);
      },
      unset: (name: string) => {
        delete vars[name];
      },
      has: (name: string) => name in vars || name in ctx.data || name in ctx.env,
      all: () => ({ ...ctx.env, ...ctx.data, ...vars }),
    },
    data: Object.freeze({ ...ctx.data }),
    env: Object.freeze({ ...ctx.env }),
    iteration: ctx.iteration,
    caseName: ctx.caseName,
    request: Object.freeze({
      ...ctx.request,
      header: (name: string) => lookupHeader(ctx.request.headers, name),
    }),
    response: res
      ? Object.freeze({
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
          time: res.durationMs,
          size: res.sizeBytes,
          body: res.body,
          text: () => res.body,
          header: (name: string) => lookupHeader(res.headers, name),
          json: () => {
            if (!parsedJson) {
              try {
                parsedJson = { value: JSON.parse(res.body) };
              } catch {
                throw new Error("Response body is not valid JSON");
              }
            }
            return parsedJson.value;
          },
        })
      : undefined,
    test: (name: string, fn: () => unknown) => {
      try {
        const r = fn();
        if (r && typeof (r as Promise<unknown>).then === "function") {
          tests.push({ name: String(name), passed: false, error: "rr.test functions cannot be async" });
          return;
        }
        tests.push({ name: String(name), passed: true });
      } catch (e) {
        tests.push({ name: String(name), passed: false, error: show(e) });
      }
    },
    expect,
    log,
  };
  const consoleShim = { log, info: log, warn: log, error: log, debug: log };

  let error: string | undefined;
  if (usesPostman(code)) {
    const names = postmanApiNames(code, 4);
    const list = names.length > 0 ? ` (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})` : "";
    return { tests, logs, vars, error: `This script still uses Postman pm.* calls${list}. Open the Scripts tab to convert them.`, durationMs: Date.now() - start };
  }
  try {
    const fn = new Function("rr", "console", `"use strict";\n${code}`);
    fn(rr, consoleShim);
  } catch (e) {
    error = e instanceof Error ? `${e.name === "Error" ? "" : e.name + ": "}${e.message}` : show(e);
  }
  return { tests, logs, vars, error, durationMs: Date.now() - start };
}
