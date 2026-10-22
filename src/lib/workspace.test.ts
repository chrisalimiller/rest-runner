import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import { environmentVars, newEnvironment } from "./environments";
import { importWorkspaceFile, toWorkspaceFile } from "./workspace";

describe("environmentVars", () => {
  it("uses enabled rows with a name", () => {
    const env = newEnvironment("Dev");
    env.vars = [
      { id: "1", key: " baseUrl ", value: "https://dev", enabled: true },
      { id: "2", key: "token", value: "t", enabled: false },
      { id: "3", key: "", value: "x", enabled: true },
    ];
    expect(environmentVars(env)).toEqual({ baseUrl: "https://dev" });
    expect(environmentVars(null)).toEqual({});
  });
});

describe("workspace export and import", () => {
  it("round-trips and merges by id", () => {
    const a = { ...newRequest(), name: "A" };
    const b = { ...newRequest(), name: "B" };
    const dev = newEnvironment("Dev");
    const text = toWorkspaceFile([a, b], [dev]);
    const result = importWorkspaceFile(text, [{ ...a, name: "old A" }], []);
    expect(result.savedRequests.map((r) => r.name)).toEqual(["A", "B"]);
    expect(result.environments.map((e) => e.name)).toEqual(["Dev"]);
    expect([result.added, result.replaced]).toEqual([2, 1]);
  });

  it("rejects other files", () => {
    expect(() => importWorkspaceFile("not json", [], [])).toThrow(/not valid JSON/);
    expect(() => importWorkspaceFile('{"hello":1}', [], [])).toThrow(/not a REST Runner/);
  });

  it("skips malformed entries", () => {
    const text = JSON.stringify({ app: "rest-runner", version: 1, savedRequests: [{ id: 1 }, newRequest()], environments: [{ name: "x" }] });
    const r = importWorkspaceFile(text, [], []);
    expect(r.savedRequests).toHaveLength(1);
    expect(r.environments).toHaveLength(0);
  });
});
