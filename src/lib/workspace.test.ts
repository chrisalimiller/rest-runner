import { describe, expect, it } from "vitest";
import { listRequests, newCollection, requestNode } from "./collections";
import { newRequest } from "./defaults";
import { environmentVars, newEnvironment, type Environment } from "./environments";
import { IMPORTED_COLLECTION_NAME, importWorkspaceFile, toWorkspaceFile } from "./workspace";

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
  it("round-trips collections and merges by id", () => {
    const a = { ...newRequest(), name: "A" };
    const b = { ...newRequest(), name: "B" };
    const col = { ...newCollection("API"), items: [requestNode(a), requestNode(b)] };
    const other = newCollection("Other");
    const dev = newEnvironment("Dev");
    const text = toWorkspaceFile([col], [dev]);
    const result = importWorkspaceFile(text, [{ ...col, name: "old" }, other], []);
    expect(result.collections.map((c) => c.name)).toEqual(["API", "Other"]);
    expect(listRequests(result.collections).map((r) => r.request.name)).toEqual(["A", "B"]);
    expect(result.environments.map((e) => e.name)).toEqual(["Dev"]);
    expect([result.added, result.replaced]).toEqual([1, 1]);
  });

  it("imports version 1 files", () => {
    const a = { ...newRequest(), name: "A" };
    const b = { ...newRequest(), name: "B" };
    const col = { ...newCollection("Mine"), items: [requestNode({ ...a, name: "old A" })] };
    const text = JSON.stringify({ app: "rest-runner", version: 1, savedRequests: [a, b], environments: [] });
    const result = importWorkspaceFile(text, [col], []);
    expect(result.collections.map((c) => c.name)).toEqual(["Mine", IMPORTED_COLLECTION_NAME]);
    expect(listRequests(result.collections).map((r) => `${r.collectionName}:${r.request.name}`)).toEqual([
      "Mine:A",
      `${IMPORTED_COLLECTION_NAME}:B`,
    ]);
    expect([result.added, result.replaced]).toEqual([1, 1]);
  });

  it("rejects other files", () => {
    expect(() => importWorkspaceFile("not json", [], [])).toThrow(/not valid JSON/);
    expect(() => importWorkspaceFile('{"hello":1}', [], [])).toThrow(/not a REST Runner/);
  });

  it("skips malformed entries", () => {
    const text = JSON.stringify({ app: "rest-runner", version: 1, savedRequests: [{ id: 1 }, newRequest()], environments: [{ name: "x" }] });
    const r = importWorkspaceFile(text, [], []);
    expect(listRequests(r.collections)).toHaveLength(1);
    expect(r.environments).toHaveLength(0);
    const v2 = JSON.stringify({ app: "rest-runner", version: 2, collections: [{ id: "c", name: "C", items: [{ kind: "request", request: { id: 2 } }, { kind: "folder", id: "f", name: "F", items: [] }] }] });
    const r2 = importWorkspaceFile(v2, [], []);
    expect(r2.collections[0].items).toHaveLength(1);
  });
});

describe("secrets in a workspace file", () => {
  const withSecret = (): Environment => ({
    ...newEnvironment("Dev"),
    vars: [
      { id: "a", key: "baseUrl", value: "https://dev", enabled: true },
      { id: "b", key: "token", value: "s3cret", enabled: true, secret: true },
    ],
  });

  it("leaves secret values out by default but keeps the flag", () => {
    const text = toWorkspaceFile([], [withSecret()]);
    expect(text).not.toContain("s3cret");
    const vars = (JSON.parse(text) as { environments: Environment[] }).environments[0].vars;
    expect(vars[1]).toMatchObject({ key: "token", value: "", secret: true });
    expect(vars[0].value).toBe("https://dev");
  });

  it("includes them when asked", () => {
    expect(toWorkspaceFile([], [withSecret()], { includeSecrets: true })).toContain("s3cret");
  });

  it("importing a file without secrets keeps the values already here", () => {
    const mine = withSecret();
    const result = importWorkspaceFile(toWorkspaceFile([], [mine]), [], [mine]);
    expect(result.environments[0].vars[1].value).toBe("s3cret");
  });

  it("a teammate gets the empty secret to fill in", () => {
    const result = importWorkspaceFile(toWorkspaceFile([], [withSecret()]), [], []);
    expect(result.environments[0].vars[1]).toMatchObject({ value: "", secret: true });
  });

  it("older environments load with nothing secret", () => {
    const old = { app: "rest-runner", version: 2, collections: [], environments: [{ id: "e", name: "Dev", vars: [{ id: "1", key: "k", value: "v", enabled: true }] }] };
    const result = importWorkspaceFile(JSON.stringify(old), [], []);
    expect(result.environments[0].vars[0].secret).toBeUndefined();
  });
});
