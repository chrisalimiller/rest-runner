import { describe, expect, it } from "vitest";
import { convertLiteralToVariable, suggestVariableName } from "./literalToVariable";
import { emptyRow } from "./defaults";
import type { Environment } from "./environments";
import type { AuthConfig } from "./types";

const env = (vars: Environment["vars"] = [emptyRow()]): Environment => ({ id: "e", name: "Dev", vars });
const basic: AuthConfig = { type: "basic", username: "u", password: "hunter2" };

describe("convertLiteralToVariable", () => {
  it("adds a secret variable, fills the blank row and swaps in the placeholder", () => {
    const r = convertLiteralToVariable(env(), basic, "auth.password");
    if (!r.ok) throw new Error("expected ok");
    expect(r.name).toBe("password");
    expect(r.auth).toEqual({ type: "basic", username: "u", password: "{{password}}" });
    expect(r.env.vars).toHaveLength(2);
    expect(r.env.vars[0]).toMatchObject({ key: "password", value: "hunter2", secret: true, enabled: true });
    expect(r.env.vars[1]).toMatchObject({ key: "", value: "" });
  });
  it("numbers the name when a different value already uses it", () => {
    const e = env([
      { ...emptyRow(), key: "password", value: "other" },
      { ...emptyRow(), key: "password_2", value: "x" },
    ]);
    const r = convertLiteralToVariable(e, basic, "auth.password");
    if (!r.ok) throw new Error("expected ok");
    expect(r.name).toBe("password_3");
    expect(r.env.vars.find((v) => v.key === "password")?.value).toBe("other");
  });
  it("reuses a variable that already holds the same value and marks it secret", () => {
    const e = env([{ ...emptyRow(), key: "password", value: "hunter2", enabled: false }]);
    const r = convertLiteralToVariable(e, basic, "auth.password");
    if (!r.ok) throw new Error("expected ok");
    expect(r.reused).toBe(true);
    expect(r.env.vars).toHaveLength(1);
    expect(r.env.vars[0]).toMatchObject({ enabled: true, secret: true });
  });
  it("does not change the input", () => {
    const e = env();
    convertLiteralToVariable(e, basic, "auth.password");
    expect(e.vars).toHaveLength(1);
    expect(e.vars[0].key).toBe("");
  });
  it("fails without an active environment", () => {
    expect(convertLiteralToVariable(null, basic, "auth.password")).toEqual({ ok: false, reason: "no-environment" });
  });
  it("fails on an empty value", () => {
    expect(convertLiteralToVariable(env(), { type: "basic", username: "", password: "" }, "auth.password")).toEqual({ ok: false, reason: "empty" });
  });
  it("handles bearer and API key", () => {
    const b = convertLiteralToVariable(env(), { type: "bearer", token: "abc" }, "auth.token");
    expect(b.ok && b.auth).toEqual({ type: "bearer", token: "{{token}}" });
    const a: AuthConfig = { type: "apikey", key: "X-API-Key", value: "k", addTo: "header" };
    expect(suggestVariableName(a, "auth.value")).toBe("x_api_key");
    const r = convertLiteralToVariable(env(), a, "auth.value");
    expect(r.ok && r.auth).toMatchObject({ value: "{{x_api_key}}" });
  });
});
