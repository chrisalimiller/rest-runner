import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DENSITY_KEY, DENSITY_PREFS, getDensityPref, isDensityPref, setDensityPref } from "./density";

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

describe("isDensityPref", () => {
  it("accepts only the three choices", () => {
    expect(DENSITY_PREFS.every(isDensityPref)).toBe(true);
    expect([isDensityPref("tight"), isDensityPref(null), isDensityPref(1), isDensityPref("")]).toEqual([false, false, false, false]);
  });
});

describe("getDensityPref", () => {
  it("defaults to default", () => {
    expect(getDensityPref()).toBe("default");
  });
  it("reads a saved choice", () => {
    localStorage.setItem(DENSITY_KEY, JSON.stringify("compact"));
    expect(getDensityPref()).toBe("compact");
  });
  it("falls back to default for garbage", () => {
    for (const raw of ["{bad", "null", '"huge"', "42", '["compact"]']) {
      localStorage.setItem(DENSITY_KEY, raw);
      expect(getDensityPref()).toBe("default");
    }
  });
  it("falls back to default when storage throws", () => {
    globalThis.localStorage = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(getDensityPref()).toBe("default");
  });
  it("round-trips through setDensityPref", () => {
    setDensityPref("comfortable");
    expect(localStorage.getItem(DENSITY_KEY)).toBe('"comfortable"');
    expect(getDensityPref()).toBe("comfortable");
  });
});

describe("index.html early script", () => {
  const html = readFileSync("index.html", "utf8");
  it("reads the same storage key as density.ts", () => {
    expect(html).toContain(`localStorage.getItem("${DENSITY_KEY}")`);
  });
  it("handles every non-default choice", () => {
    for (const p of DENSITY_PREFS.filter((p) => p !== "default")) expect(html).toContain(`"${p}"`);
  });
});
