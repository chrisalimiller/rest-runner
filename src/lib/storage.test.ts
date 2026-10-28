import { beforeEach, describe, expect, it } from "vitest";
import { clearViewState, isStringArray, isStringRecord, load, VIEW_STATE_KEYS } from "./storage";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});

describe("load", () => {
  it("returns the fallback for a missing key or broken JSON", () => {
    expect(load("k", 1)).toBe(1);
    localStorage.setItem("k", "{bad");
    expect(load("k", 1)).toBe(1);
  });

  it("returns the fallback for a stored null", () => {
    localStorage.setItem("k", "null");
    expect(load("k", [])).toEqual([]);
  });

  it("returns the fallback when the value fails the check", () => {
    for (const bad of ["5", '"text"', "{}", "[1,2]", "true"]) {
      localStorage.setItem("k", bad);
      expect(load("k", ["x"], isStringArray)).toEqual(["x"]);
    }
    localStorage.setItem("k", '["a","b"]');
    expect(load("k", [], isStringArray)).toEqual(["a", "b"]);
  });

  it("keeps the old behaviour without a check", () => {
    localStorage.setItem("k", "42");
    expect(load("k", 0)).toBe(42);
  });
});

describe("guards", () => {
  it("isStringRecord accepts only objects of strings", () => {
    expect(isStringRecord({ a: "1" })).toBe(true);
    expect(isStringRecord({ a: 1 })).toBe(false);
    expect(isStringRecord(["a"])).toBe(false);
  });
});

describe("clearViewState", () => {
  it("clears view keys and keeps saved data", () => {
    for (const k of VIEW_STATE_KEYS) localStorage.setItem(k, "1");
    localStorage.setItem("rest-runner.collections", "[]");
    localStorage.setItem("rest-runner.environments", "[]");
    clearViewState();
    for (const k of VIEW_STATE_KEYS) expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem("rest-runner.collections")).toBe("[]");
    expect(localStorage.getItem("rest-runner.environments")).toBe("[]");
  });
});
