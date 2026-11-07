"use strict";
function show(v) {
    if (typeof v === "string")
        return v;
    if (v instanceof Error)
        return v.message;
    try {
        return JSON.stringify(v) ?? String(v);
    }
    catch {
        return String(v);
    }
}
function fail(message) {
    throw new Error(message);
}
function deepEqual(a, b) {
    if (Object.is(a, b))
        return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}
/** A small expect() in the style of Jest. Every matcher also works after .not. */
function makeExpect(actual, negate = false) {
    const check = (ok, message) => {
        if (ok === negate)
            fail(negate ? `Expected not: ${message}` : `Expected ${message}`);
    };
    const m = {
        toBe: (expected) => check(Object.is(actual, expected), `${show(actual)} to be ${show(expected)}`),
        toEqual: (expected) => check(deepEqual(actual, expected), `${show(actual)} to equal ${show(expected)}`),
        toBeTruthy: () => check(!!actual, `${show(actual)} to be truthy`),
        toBeFalsy: () => check(!actual, `${show(actual)} to be falsy`),
        toBeDefined: () => check(actual !== undefined, `value to be defined`),
        toBeUndefined: () => check(actual === undefined, `${show(actual)} to be undefined`),
        toBeNull: () => check(actual === null, `${show(actual)} to be null`),
        toBeGreaterThan: (n) => check(typeof actual === "number" && actual > n, `${show(actual)} to be greater than ${n}`),
        toBeGreaterThanOrEqual: (n) => check(typeof actual === "number" && actual >= n, `${show(actual)} to be at least ${n}`),
        toBeLessThan: (n) => check(typeof actual === "number" && actual < n, `${show(actual)} to be less than ${n}`),
        toBeLessThanOrEqual: (n) => check(typeof actual === "number" && actual <= n, `${show(actual)} to be at most ${n}`),
        toContain: (item) => check(typeof actual === "string" ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((x) => deepEqual(x, item)), `${show(actual)} to contain ${show(item)}`),
        toMatch: (re) => check(typeof actual === "string" && (typeof re === "string" ? new RegExp(re) : re).test(actual), `${show(actual)} to match ${String(re)}`),
        toHaveProperty: (key) => check(!!actual && typeof actual === "object" && Object.prototype.hasOwnProperty.call(actual, key), `${show(actual)} to have property "${key}"`),
        toHaveLength: (n) => check((Array.isArray(actual) || typeof actual === "string") && actual.length === n, `${show(actual)} to have length ${n}`),
    };
    return m;
}
function expect(actual) {
    return { ...makeExpect(actual), not: makeExpect(actual, true) };
}
/**
 * Runs a script synchronously and reports what it did. The script gets `rr` and `console`.
 * This does not enforce a time limit; scriptRunner.ts runs it in a Worker for that.
 */
function executeScript(code, ctx) {
    const start = Date.now();
    const vars = { ...ctx.vars };
    const tests = [];
    const logs = [];
    const log = (...args) => logs.push(args.map(show).join(" "));
    const res = ctx.response;
    const lookupHeader = (headers, name) => {
        const lower = name.toLowerCase();
        const found = headers.filter(([k]) => k.toLowerCase() === lower).map(([, v]) => v);
        return found.length ? found.join(", ") : undefined;
    };
    let parsedJson = null;
    const rr = {
        vars: {
            /** Looks in run variables, then the CSV row, then the environment. */
            get: (name) => (name in vars ? vars[name] : name in ctx.data ? ctx.data[name] : ctx.env[name]),
            set: (name, value) => {
                vars[String(name)] = typeof value === "string" ? value : show(value);
            },
            unset: (name) => {
                delete vars[name];
            },
            has: (name) => name in vars || name in ctx.data || name in ctx.env,
            all: () => ({ ...ctx.env, ...ctx.data, ...vars }),
        },
        data: Object.freeze({ ...ctx.data }),
        env: Object.freeze({ ...ctx.env }),
        iteration: ctx.iteration,
        caseName: ctx.caseName,
        request: Object.freeze({
            ...ctx.request,
            header: (name) => lookupHeader(ctx.request.headers, name),
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
                header: (name) => lookupHeader(res.headers, name),
                json: () => {
                    if (!parsedJson) {
                        try {
                            parsedJson = { value: JSON.parse(res.body) };
                        }
                        catch {
                            throw new Error("Response body is not valid JSON");
                        }
                    }
                    return parsedJson.value;
                },
            })
            : undefined,
        test: (name, fn) => {
            if (typeof fn !== "function") {
                tests.push({ name: String(name), passed: false, error: "rr.test needs a function as its second argument, for example rr.test(\"name\", () => rr.expect(x).toBe(1))" });
                return;
            }
            try {
                const r = fn();
                if (r && typeof r.then === "function") {
                    tests.push({ name: String(name), passed: false, error: "rr.test functions cannot be async" });
                    return;
                }
                tests.push({ name: String(name), passed: true });
            }
            catch (e) {
                tests.push({ name: String(name), passed: false, error: show(e) });
            }
        },
        expect,
        log,
    };
    const consoleShim = { log, info: log, warn: log, error: log, debug: log };
    let error;
    try {
        const fn = new Function("rr", "console", `"use strict";\n${code}`);
        fn(rr, consoleShim);
    }
    catch (e) {
        error = e instanceof Error ? `${e.name === "Error" ? "" : e.name + ": "}${e.message}` : show(e);
    }
    return { tests, logs, vars, error, durationMs: Date.now() - start };
}
