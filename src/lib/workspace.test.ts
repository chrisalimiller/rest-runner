import { describe, expect, it } from "vitest";
import { listRequests, newCollection, requestNode } from "./collections";
import { newRequest } from "./defaults";
import { environmentVars, newEnvironment, type Environment } from "./environments";
import sample from "../assets/sample-workspace.json";
import { toFlowsFile } from "./flows/flowFile";
import { newFlow } from "./flows/flows";
import { toSuitesFile } from "./testing/suiteFile";
import { newSuite, newTestCase } from "./testing/suites";
import { IMPORTED_COLLECTION_NAME, describeWorkspaceImport, importWorkspace, importWorkspaceFile, toWorkspaceFile } from "./workspace";

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

describe("combined workspace file", () => {
  const empty = { collections: [], environments: [], suites: [], flows: [] };

  it("round-trips collections, environments, suites and flows", () => {
    const col = { ...newCollection("API"), items: [requestNode({ ...newRequest(), name: "A" })] };
    const suite = { ...newSuite("Checks"), cases: [newTestCase()] };
    const flow = { ...newFlow("Nightly") };
    const text = toWorkspaceFile([col], [newEnvironment("Dev")], { suites: [suite], flows: [flow] });
    expect(JSON.parse(text)).toMatchObject({ kind: "workspace", version: 4 });
    const r = importWorkspace(text, empty);
    expect(r.collections.map((c) => c.name)).toEqual(["API"]);
    expect(r.environments.map((e) => e.name)).toEqual(["Dev"]);
    expect(r.suites.map((s) => s.name)).toEqual(["Checks"]);
    expect(r.flows.map((f) => f.name)).toEqual(["Nightly"]);
    expect(r.counts).toMatchObject({ suites: [1, 0], flows: [1, 0], environments: [1, 0] });
    const again = importWorkspace(text, r);
    expect(again.counts).toMatchObject({ suites: [0, 1], flows: [0, 1], environments: [0, 1] });
    expect(again.flows).toHaveLength(1);
  });

  it("still imports version 2 files, and suites and flows files", () => {
    const col = { ...newCollection("Old"), items: [requestNode(newRequest())] };
    const v2 = JSON.stringify({ app: "rest-runner", version: 2, collections: [col], environments: [] });
    expect(importWorkspace(v2, empty).collections.map((c) => c.name)).toEqual(["Old"]);
    const suite = newSuite("S");
    const suites = importWorkspace(toSuitesFile([suite]), empty);
    expect(suites.suites.map((s) => s.name)).toEqual(["S"]);
    const flows = importWorkspace(toFlowsFile([newFlow("F")], [], []), empty);
    expect(flows.flows.map((f) => f.name)).toEqual(["F"]);
    expect(() => importWorkspace('{"x":1}', empty)).toThrow(/not a REST Runner/);
  });

  it("describes what changed", () => {
    expect(describeWorkspaceImport("a.json", { collections: [1, 0], environments: [0, 0], suites: [0, 2], flows: [0, 0], requests: [0, 0] })).toBe(
      "Imported a.json: collections: 1 added; suites: 2 updated.",
    );
    expect(describeWorkspaceImport("a.json", { collections: [0, 0], environments: [0, 0], suites: [0, 0], flows: [0, 0], requests: [0, 0] })).toBe("Imported a.json: nothing new.");
  });

  it("ships a sample workspace that imports cleanly and keeps its flow wired", () => {
    const r = importWorkspace(JSON.stringify(sample), empty);
    expect(listRequests(r.collections)).toHaveLength(3);
    expect(r.suites[0].cases).toHaveLength(2);
    expect(r.suites[0].data?.text).toContain("Ada");
    expect(r.flows[0].nodes).toHaveLength(3);
    expect(r.flows[0].edges).toHaveLength(2);
    expect(r.environments[0].vars.find((v) => v.key === "baseUrl")?.value).toMatch(/^https:\/\//);
    expect(JSON.stringify(sample)).not.toMatch(/naap|secret/i);
  });
});
