import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { getThemePref, isThemePref, resolveTheme, THEME_KEY } from "./theme";

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

describe("resolveTheme", () => {
  it("follows the system only for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("keeps an explicit choice whatever the system says", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("isThemePref", () => {
  it("accepts only the three choices", () => {
    expect(["system", "dark", "light"].every(isThemePref)).toBe(true);
    expect([isThemePref("auto"), isThemePref(null), isThemePref(1), isThemePref("")]).toEqual([false, false, false, false]);
  });
});

describe("getThemePref", () => {
  it("defaults to system", () => {
    expect(getThemePref()).toBe("system");
  });
  it("reads a saved choice", () => {
    localStorage.setItem(THEME_KEY, JSON.stringify("light"));
    expect(getThemePref()).toBe("light");
  });
  it("falls back to system for garbage", () => {
    for (const raw of ["{bad", "null", '"purple"', "42", '["dark"]']) {
      localStorage.setItem(THEME_KEY, raw);
      expect(getThemePref()).toBe("system");
    }
  });
  it("falls back to system when storage throws", () => {
    globalThis.localStorage = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(getThemePref()).toBe("system");
  });
});

describe("index.html early script", () => {
  const html = readFileSync("index.html", "utf8");
  it("reads the same storage key as theme.ts", () => {
    expect(html).toContain(`localStorage.getItem("${THEME_KEY}")`);
  });
  it("sets data-theme to a resolved value only", () => {
    expect(html).toContain('d ? "dark" : "light"');
    expect(html).not.toContain('dataset.theme = "system"');
  });
});
