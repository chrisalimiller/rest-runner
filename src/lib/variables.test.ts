import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import { newEnvironment } from "./environments";
import { addEnvVar, requestVariableRows, resolveVariable, setEnvVarValue, sourceLabel, variableIndex } from "./variables";

describe("requestVariableRows", () => {
  const env = {
    ...newEnvironment("SIT"),
    vars: [
      { id: "a", key: "base", value: "https://sit", enabled: true },
      { id: "b", key: "token", value: "s3", enabled: true, secret: true },
      { id: "c", key: "off", value: "x", enabled: false },
    ],
  };
  const def = { ...newRequest(), url: "{{base}}/t/{{ticketId}}/{{off}}", headers: [{ id: "h", key: "A", value: "{{token}}", enabled: true }] };

  it("names the source of each placeholder", () => {
    const rows = requestVariableRows(def, env, { ticketId: "TT-1" });
    expect(rows.map((r) => [r.name, sourceLabel(r.source)])).toEqual([
      ["base", "Env · SIT"],
      ["ticketId", "Script"],
      ["off", "Unset"],
      ["token", "Env · SIT"],
    ]);
    expect(rows.find((r) => r.name === "token")).toMatchObject({ secret: true, envVarId: "b" });
  });

  it("lets a script variable win over the environment", () => {
    expect(requestVariableRows(def, env, { base: "x" })[0]).toMatchObject({ value: "x", source: { kind: "script" } });
  });

  it("marks everything unset without an environment", () => {
    expect(requestVariableRows(def, null, {}).every((r) => r.source.kind === "unset")).toBe(true);
  });

  it("uses the last enabled row when an environment repeats a key, as sending does", () => {
    const dup = {
      ...newEnvironment("SIT"),
      vars: [
        { id: "a", key: "base", value: "first", enabled: true },
        { id: "b", key: "base", value: "second", enabled: true },
        { id: "c", key: "base", value: "off", enabled: false },
      ],
    };
    const row = requestVariableRows({ ...newRequest(), url: "{{base}}" }, dup, {})[0];
    expect(row).toMatchObject({ value: "second", envVarId: "b" });
  });
});

describe("resolveVariable", () => {
  const dev = { ...newEnvironment("Dev"), id: "dev", vars: [{ id: "d1", key: "token", value: "dev-t", enabled: true }, { id: "d2", key: "off", value: "x", enabled: false }] };
  const prod = { ...newEnvironment("Prod"), id: "prod", vars: [{ id: "p1", key: "token", value: "prod-t", enabled: true }, { id: "p2", key: "only", value: "o", enabled: true }] };
  const envs = [prod, dev];

  it("lets a script variable beat the active environment, which it shadows", () => {
    const r = resolveVariable("token", envs, "dev", { token: "s" });
    expect(r.winner).toMatchObject({ kind: "script", value: "s" });
    expect(r.shadowed).toMatchObject([{ kind: "env", envId: "dev", value: "dev-t" }]);
    expect(r.layers).toHaveLength(3);
  });

  it("uses the active environment only", () => {
    expect(resolveVariable("token", envs, "dev", {}).winner).toMatchObject({ envId: "dev", varId: "d1" });
    expect(resolveVariable("only", envs, "dev", {}).winner).toBeNull();
    expect(resolveVariable("only", envs, "dev", {}).layers).toHaveLength(1);
  });

  it("ignores disabled rows and picks the last of a repeated key", () => {
    expect(resolveVariable("off", envs, "dev", {}).layers).toEqual([]);
    const dup = { ...dev, vars: [...dev.vars, { id: "d3", key: "token", value: "later", enabled: true }] };
    expect(resolveVariable("token", [dup], "dev", {}).winner).toMatchObject({ varId: "d3", value: "later" });
  });
});

describe("variableIndex", () => {
  const dev = { ...newEnvironment("Dev"), id: "dev", vars: [{ id: "d1", key: "token", value: "dev-t", enabled: true }, { id: "d2", key: "base", value: "b", enabled: true }, { id: "d3", key: "base", value: "b2", enabled: true }] };
  const prod = { ...newEnvironment("Prod"), id: "prod", vars: [{ id: "p1", key: "token", value: "prod-t", enabled: true }] };

  it("groups by priority and flags what is hidden", () => {
    const g = variableIndex([dev, prod], "dev", { token: "s" }, null);
    expect(g.missing).toEqual([]);
    expect(g.script).toEqual([{ name: "token", value: "s", used: false, hidesEnv: true }]);
    expect(g.active?.rows.map((r) => [r.varId, r.overriddenBy])).toEqual([["d1", "script"], ["d2", "later row"], ["d3", undefined]]);
    expect(g.others.map((o) => o.env.id)).toEqual(["prod"]);
  });

  it("narrows to the request's names and lists the missing ones", () => {
    const g = variableIndex([dev, prod], "dev", {}, ["token", "orderId"]);
    expect(g.missing).toEqual(["orderId"]);
    expect(g.active?.rows.map((r) => [r.name, r.used])).toEqual([["token", true]]);
    expect(g.others[0].rows[0].name).toBe("token");
  });
});

describe("setEnvVarValue and addEnvVar", () => {
  const dev = { ...newEnvironment("Dev"), id: "dev", vars: [{ id: "a", key: "k", value: "1", enabled: true }, { id: "b", key: "", value: "", enabled: true }] };
  const other = { ...newEnvironment("Other"), id: "o", vars: [{ id: "a2", key: "k", value: "1", enabled: true }] };

  it("changes only the target row", () => {
    const next = setEnvVarValue([dev, other], "dev", "a", "2");
    expect(next[0].vars[0].value).toBe("2");
    expect(next[1]).toBe(other);
  });

  it("drops blank rows, appends the variable and one empty row", () => {
    const r = addEnvVar([dev, other], "dev", "n", "v", true);
    expect(r.envs[0].vars.map((v) => v.key)).toEqual(["k", "n", ""]);
    expect(r.envs[0].vars[1]).toMatchObject({ id: r.varId, value: "v", secret: true });
    expect(r.envs[1]).toBe(other);
  });

  it("creates Environment 1 when there is none", () => {
    const r = addEnvVar([], null, "n", "v", false);
    expect(r.envs).toHaveLength(1);
    expect(r.envs[0].name).toBe("Environment 1");
    expect(r.envId).toBe(r.envs[0].id);
  });
});
