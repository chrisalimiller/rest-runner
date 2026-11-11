import { beforeEach, describe, expect, it } from "vitest";
import { cleanEnvironments, newEnvironment } from "./environments";
import { CONFIRM_PRODUCTION_KEY, isProductionEnv, loadConfirmProduction, productionToConfirm, saveConfirmProduction } from "./productionGuard";
import { exportEnvironments, importWorkspaceFile, toWorkspaceFile } from "./workspace";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("confirm before production setting", () => {
  it("defaults to on, persists, and ignores junk", () => {
    expect(loadConfirmProduction()).toBe(true);
    expect(saveConfirmProduction(false)).toBe(true);
    expect(loadConfirmProduction()).toBe(false);
    store.set(CONFIRM_PRODUCTION_KEY, JSON.stringify("nope"));
    expect(loadConfirmProduction()).toBe(true);
  });
});

describe("production flag", () => {
  it("is never inferred from the name or colour", () => {
    const prod = newEnvironment("Production");
    expect(prod.isProduction).toBe(false);
    expect(isProductionEnv(prod)).toBe(false);
    expect(productionToConfirm({ ...prod, color: "red" }, true)).toBeNull();
  });

  it("asks only when enabled and flagged", () => {
    const env = { ...newEnvironment("Live"), isProduction: true };
    expect(productionToConfirm(env, true)).toBe("Live");
    expect(productionToConfirm(env, false)).toBeNull();
    expect(productionToConfirm({ ...env, isProduction: false }, true)).toBeNull();
    expect(productionToConfirm(null, true)).toBeNull();
    expect(productionToConfirm({ ...env, name: " " }, true)).toBe("(unnamed)");
  });

  it("defaults to false on old data and keeps true", () => {
    const out = cleanEnvironments([
      { id: "1", name: "Prod", vars: [] },
      { id: "2", name: "X", vars: [], isProduction: true },
      { id: "3", name: "Y", vars: [], isProduction: "yes" },
    ]);
    expect(out.map((e) => e.isProduction)).toEqual([false, true, false]);
  });

  it("survives export and import", () => {
    const env = { ...newEnvironment("Live"), isProduction: true };
    expect(exportEnvironments([env], false)[0].isProduction).toBe(true);
    const text = toWorkspaceFile([], [env], { suites: [], flows: [] });
    expect(importWorkspaceFile(text, [], []).environments[0].isProduction).toBe(true);
  });
});
