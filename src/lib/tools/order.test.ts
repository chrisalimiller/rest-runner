import { describe, expect, it } from "vitest";
import { callDependencies, orderCalls } from "./order";
import type { ToolCall } from "./types";

function call(id: string, needs: Record<string, string> = {}): ToolCall {
  const mappings: ToolCall["mappings"] = {};
  for (const [placeholder, from] of Object.entries(needs)) mappings[placeholder] = { call: { callId: from, path: "x" } };
  return { id, name: id.toUpperCase(), requestId: "r", mappings, write: false };
}

describe("callDependencies", () => {
  it("lists each call once, and only the placeholders asked about", () => {
    const c = call("c", { a: "x", b: "x", d: "y" });
    expect(callDependencies(c)).toEqual(["x", "y"]);
    expect(callDependencies(c, ["a"])).toEqual(["x"]);
  });

  it("ignores input and fixed mappings", () => {
    const c: ToolCall = { ...call("c"), mappings: { a: { input: "id" }, b: { fixed: "1" } } };
    expect(callDependencies(c)).toEqual([]);
  });
});

describe("orderCalls", () => {
  it("puts independent calls in one level, in the tool's order", () => {
    const r = orderCalls([call("a"), call("b"), call("c")]);
    expect(r.ok && r.levels.map((l) => l.map((c) => c.id))).toEqual([["a", "b", "c"]]);
  });

  it("puts a call after the call it needs, whatever order they are listed in", () => {
    const r = orderCalls([call("c", { p: "b" }), call("b", { p: "a" }), call("a")]);
    expect(r.ok && r.order.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(r.ok && r.levels.length).toBe(3);
  });

  it("starts the independent branches of a diamond together", () => {
    const r = orderCalls([call("a"), call("b", { p: "a" }), call("c", { p: "a" }), call("d", { x: "b", y: "c" })]);
    expect(r.ok && r.levels.map((l) => l.map((c) => c.id))).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("refuses a loop between two calls and names them", () => {
    const r = orderCalls([call("a", { p: "b" }), call("b", { p: "a" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cycle[0]).toBe(r.cycle[r.cycle.length - 1]);
      expect(new Set(r.cycle)).toEqual(new Set(["a", "b"]));
      expect(r.message).toContain("A needs B");
      expect(r.message).toContain("B needs A");
    }
  });

  it("finds a loop that sits behind a call that is fine", () => {
    const r = orderCalls([call("ok"), call("a", { p: "c" }), call("b", { p: "a" }), call("c", { p: "b" }), call("tail", { p: "c" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(new Set(r.cycle)).toEqual(new Set(["a", "b", "c"]));
  });

  it("refuses a call that needs itself", () => {
    const r = orderCalls([call("a", { p: "a" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("its own result");
  });

  it("ignores a mapping to a call that no longer exists", () => {
    const r = orderCalls([call("a", { p: "gone" })]);
    expect(r.ok).toBe(true);
  });

  it("ignores mappings for placeholders the request no longer uses", () => {
    const calls = [call("a", { old: "b" }), call("b", { p: "a" })];
    expect(orderCalls(calls).ok).toBe(false);
    expect(orderCalls(calls, (c) => (c.id === "a" ? ["other"] : ["p"])).ok).toBe(true);
  });
});
