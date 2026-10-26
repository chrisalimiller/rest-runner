import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import { newEnvironment } from "./environments";
import { requestVariableRows, sourceLabel } from "./variables";

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
});
