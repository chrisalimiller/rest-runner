import { describe, expect, it } from "vitest";
import { listRequests } from "./collections";
import { prepareRequest } from "./request";
import { detectPostmanFile, importPostmanCollection, importPostmanEnvironment } from "./postman";
import { importWorkspaceFile } from "./workspace";

const collection = {
  info: { _postman_id: "abc-1", name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
  variable: [{ key: "baseUrl", value: "https://shop.test" }, { key: "off", value: "x", disabled: true }],
  event: [{ listen: "prerequest", script: { exec: ["pm.variables.set('a', 1)"] } }],
  item: [
    {
      name: "Users",
      auth: { type: "basic", basic: [{ key: "username", value: "u" }, { key: "password", value: "p" }] },
      item: [
        {
          name: "Create",
          request: {
            method: "post",
            header: [{ key: "X-A", value: "1" }, { key: "X-B", value: "2", disabled: true }],
            body: { mode: "raw", raw: '{"n":"{{name}}"}', options: { raw: { language: "json" } } },
            url: { raw: "{{baseUrl}}/users/:id?a=1&b=2", path: ["users", ":id"], query: [{ key: "a", value: "1" }, { key: "b", value: "2", disabled: true }], variable: [{ key: "id", value: "7" }] },
          },
          response: [{ name: "Created", code: 201, status: "Created", header: [{ key: "Content-Type", value: "application/json" }], body: "{}" }],
        },
        { name: "Nested", item: [{ name: "Inherits basic", request: "https://x.test/a" }] },
      ],
    },
    { name: "Login", request: { method: "GET", auth: { type: "noauth" }, url: "{{baseUrl}}/login" } },
    { name: "Top", request: { method: "GET", url: "{{baseUrl}}/top" }, event: [{ listen: "test", script: { exec: ["pm.test()"] } }] },
    { name: "Form", request: { method: "POST", url: "{{baseUrl}}/f", body: { mode: "formdata", formdata: [{ key: "a", value: "1", type: "text" }, { key: "f", type: "file", src: "x" }] } } },
    { name: "Key", request: { method: "GET", url: "{{baseUrl}}/k", auth: { type: "apikey", apikey: { key: "k", value: "v", in: "query" } } } },
    { name: "OAuth", request: { method: "GET", url: "{{baseUrl}}/o", auth: { type: "oauth2", oauth2: [] } } },
    { name: "Weird", request: { method: "PROPFIND", url: "x" } },
  ],
};

describe("detectPostmanFile", () => {
  it("tells collections, environments and others apart", () => {
    expect(detectPostmanFile(collection)).toBe("collection");
    expect(detectPostmanFile({ name: "Dev", values: [] })).toBe("environment");
    expect(detectPostmanFile({ app: "rest-runner", name: "x", values: [] })).toBeNull();
    expect(detectPostmanFile([])).toBeNull();
  });
});

describe("importPostmanCollection", () => {
  const r = importPostmanCollection(collection);
  const byName = Object.fromEntries(listRequests([r.collection]).map((e) => [e.request.name, e]));

  it("keeps folders and nesting", () => {
    expect(r.collection.name).toBe("Shop");
    expect(byName.Create.folderPath).toEqual(["Users"]);
    expect(byName["Inherits basic"].folderPath).toEqual(["Users", "Nested"]);
  });

  it("converts url, query rows, path variables, headers and json body", () => {
    const d = byName.Create.request;
    expect(d.method).toBe("POST");
    expect(d.url).toBe("{{baseUrl}}/users/7");
    expect(d.params.map((p) => [p.key, p.value, p.enabled])).toEqual([["a", "1", true], ["b", "2", false]]);
    expect(d.headers.map((h) => [h.key, h.enabled])).toEqual([["X-A", true], ["X-B", false]]);
    expect(d.bodyMode).toBe("json");
    expect(prepareRequest(d, { baseUrl: "https://s", name: "Z" }).url).toBe("https://s/users/7?a=1");
  });

  it("resolves inherited auth and explicit overrides", () => {
    expect(byName.Create.request.auth).toEqual({ type: "basic", username: "u", password: "p" });
    expect(byName["Inherits basic"].request.auth.type).toBe("basic");
    expect(byName.Login.request.auth).toEqual({ type: "none" });
    expect(byName.Top.request.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(byName.Key.request.auth).toEqual({ type: "apikey", key: "k", value: "v", addTo: "query" });
    expect(byName.OAuth.request.auth).toEqual({ type: "none" });
  });

  it("handles string requests, form-data and examples", () => {
    expect(byName["Inherits basic"].request.url).toBe("https://x.test/a");
    expect(byName.Form.request.bodyMode).toBe("urlencoded");
    expect(byName.Form.request.formBody.map((f) => f.key)).toEqual(["a"]);
    expect(byName.Create.examples[0].response).toMatchObject({ status: 201, statusText: "Created", body: "{}" });
    expect(byName.Create.examples[0].request.id).toBe(byName.Create.examples[0].id);
  });

  it("makes an environment from collection variables and warns about what it skipped", () => {
    expect(r.variables?.vars.map((v) => [v.key, v.enabled])).toEqual([["baseUrl", true], ["off", false]]);
    expect(r.warnings.join("\n")).toMatch(/oauth2/);
    expect(r.warnings.join("\n")).toMatch(/PROPFIND/);
    expect(r.warnings.join("\n")).toMatch(/file field was dropped/);
    expect(r.warnings.join("\n")).toMatch(/2 collection, folder or request scripts were not imported/);
    expect(byName.Weird).toBeUndefined();
  });

  it("converts graphql and rejects other files", () => {
    const g = importPostmanCollection({ info: { name: "G" }, item: [{ name: "q", request: { method: "POST", url: "x", body: { mode: "graphql", graphql: { query: "{a}", variables: '{"x":1}' } } } }] });
    const d = listRequests([g.collection])[0].request;
    expect(JSON.parse(d.body)).toEqual({ query: "{a}", variables: { x: 1 } });
    expect(() => importPostmanCollection({})).toThrow(/not a Postman/);
  });
});

describe("importPostmanEnvironment", () => {
  it("keeps disabled rows and flags secrets", () => {
    const { environment, warnings } = importPostmanEnvironment({
      id: "e1",
      name: "Dev",
      values: [{ key: "a", value: "1", enabled: true }, { key: "b", value: 2, enabled: false }, { key: "s", value: "", type: "secret", enabled: true }, { key: "", value: "x" }],
    });
    expect(environment.name).toBe("Dev");
    expect(environment.vars.map((v) => [v.key, v.value, v.enabled])).toEqual([["a", "1", true], ["b", "2", false], ["s", "", true]]);
    expect(warnings).toHaveLength(1);
  });
});

describe("importWorkspaceFile with Postman files", () => {
  it("adds a collection and its variables, and replaces them on re-import", () => {
    const text = JSON.stringify(collection);
    const first = importWorkspaceFile(text, [], []);
    expect(first.collections).toHaveLength(1);
    expect(first.environments.map((e) => e.name)).toEqual(["Shop variables"]);
    expect([first.added, first.replaced]).toEqual([2, 0]);
    const again = importWorkspaceFile(text, first.collections, first.environments);
    expect(again.collections).toHaveLength(1);
    expect([again.added, again.replaced]).toEqual([0, 2]);
  });

  it("imports an environment file", () => {
    const r = importWorkspaceFile(JSON.stringify({ id: "e", name: "Dev", values: [{ key: "a", value: "1", enabled: true }] }), [], []);
    expect(r.environments.map((e) => e.name)).toEqual(["Dev"]);
    expect(r.added).toBe(1);
  });
});
