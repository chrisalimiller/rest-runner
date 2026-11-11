import { describe, expect, it } from "vitest";
import { countRequests } from "./collections";
import { envNameFromFile, isBrunoCollection, looksLikeBrunoEnvironment, looksLikeDotEnv, looksSecret, markSecretLooking, parseBrunoCollection, parseBrunoEnvironment, parseDotEnv, parseInsomnia } from "./importFormats";
import { emptyRow } from "./defaults";

describe("looksSecret", () => {
  it.each(["token", "API_KEY", "apiKey", "client_secret", "clientSecret", "DB_PASSWORD", "authToken", "access-token", "apikey", "Password", "jwt"])("flags %s", (n) => {
    expect(looksSecret(n)).toBe(true);
  });
  it.each(["baseUrl", "host", "monkey", "keyboard", "port", "user", "tokenizer_count_x", "keystone"])("leaves %s alone", (n) => {
    // "tokenizer_count_x" has the word "tokenizer", which is not a secret word.
    expect(looksSecret(n)).toBe(false);
  });
  it("marks matching variables only and keeps existing secrets", () => {
    const env = markSecretLooking({
      id: "e",
      name: "e",
      vars: [
        { id: "1", key: "host", value: "h", enabled: true },
        { id: "2", key: "api_token", value: "t", enabled: true },
        { id: "3", key: "other", value: "o", enabled: true, secret: true },
        { ...emptyRow(), id: "4" },
      ],
    });
    expect(env.vars.map((v) => !!v.secret)).toEqual([false, true, true, false]);
  });
});

describe("parseDotEnv", () => {
  it("reads KEY=VALUE, export, quotes and comments", () => {
    const text = ["# comment", "", "HOST=https://x.test", 'export TOKEN="a b\\nc"', "SINGLE='x # y'", "PLAIN=value # trailing", "EMPTY=", "HOST=https://y.test"].join("\n");
    const { environment } = parseDotEnv(text, "dev");
    expect(environment.name).toBe("dev");
    const m = Object.fromEntries(environment.vars.map((v) => [v.key, v.value]));
    expect(m).toEqual({ HOST: "https://y.test", TOKEN: "a b\nc", SINGLE: "x # y", PLAIN: "value", EMPTY: "" });
  });
  it("handles CRLF and a BOM", () => {
    expect(parseDotEnv("\uFEFFA=1\r\nB=2\r\n", "x").environment.vars.map((v) => v.value)).toEqual(["1", "2"]);
  });
  it("warns about interpolation and rejects empty files", () => {
    expect(parseDotEnv("A=${B}", "x").warnings).toHaveLength(1);
    expect(() => parseDotEnv("# nothing", "x")).toThrow();
  });
  it("detects .env text", () => {
    expect(looksLikeDotEnv("A=1\n# c\nB=2")).toBe(true);
    expect(looksLikeDotEnv("A=1\nthis is prose")).toBe(false);
    expect(looksLikeDotEnv("# only a comment")).toBe(false);
  });
  it("names environments from file names", () => {
    expect(envNameFromFile(".env")).toBe("Imported .env");
    expect(envNameFromFile(".env.production")).toBe("production");
    expect(envNameFromFile("C:\\x\\staging.env")).toBe("staging");
    expect(envNameFromFile("vars.txt")).toBe("vars");
  });
});

describe("Bruno", () => {
  const bru = `vars {
  host: https://api.test
  ~old: x
  note: a: b
}
vars:secret [
  token,
  ~spare
]
`;
  it("reads an environment file", () => {
    expect(looksLikeBrunoEnvironment(bru)).toBe(true);
    const { environment, warnings } = parseBrunoEnvironment(bru, "Local");
    expect(environment.vars.map((v) => [v.key, v.value, v.enabled, !!v.secret])).toEqual([
      ["host", "https://api.test", true, false],
      ["old", "x", false, false],
      ["note", "a: b", true, false],
      ["token", "", true, true],
      ["spare", "", false, true],
    ]);
    expect(warnings).toHaveLength(1);
  });
  it("does not mistake a request file for an environment", () => {
    expect(looksLikeBrunoEnvironment("meta {\n name: x\n}\nget {\n url: u\n}\nvars {\n a: b\n}")).toBe(false);
  });
  it("rejects an environment with no variables", () => {
    expect(() => parseBrunoEnvironment("vars {\n}\n", "x")).toThrow();
  });

  const collection = {
    name: "Shop",
    version: "1",
    brunoConfig: {},
    items: [
      {
        type: "folder",
        name: "Orders",
        items: [
          {
            type: "http-request",
            name: "Create",
            request: {
              method: "POST",
              url: "{{host}}/orders",
              headers: [{ name: "X-A", value: "1", enabled: true }],
              params: [{ name: "q", value: "1", type: "query", enabled: true }, { name: "id", value: "2", type: "path", enabled: true }],
              body: { mode: "json", json: '{"a":1}' },
              auth: { mode: "bearer", bearer: { token: "{{token}}" } },
              script: { req: "bru.setVar('a', 1)" },
            },
          },
        ],
      },
      { type: "http-request", name: "Odd", request: { method: "TRACE", url: "u" } },
      { type: "http-request", name: "Form", request: { method: "POST", url: "u", body: { mode: "multipartForm", multipartForm: [{ name: "a", value: "1", type: "text" }, { name: "f", value: "x", type: "file" }] }, auth: { mode: "digest" } } },
    ],
    environments: [{ name: "Dev", variables: [{ name: "host", value: "h", enabled: true, secret: false }, { name: "token", value: "", enabled: true, secret: true }] }, { name: "Empty", variables: [] }],
  };

  it("converts a collection export", () => {
    expect(isBrunoCollection(collection)).toBe(true);
    const r = parseBrunoCollection(collection);
    expect(r.collections[0].name).toBe("Shop");
    expect(countRequests(r.collections[0].items)).toBe(2);
    const folder = r.collections[0].items[0];
    expect(folder.kind).toBe("folder");
    const create = folder.kind === "folder" && folder.items[0].kind === "request" ? folder.items[0].request : null;
    expect(create).toMatchObject({ method: "POST", url: "{{host}}/orders", bodyMode: "json", body: '{"a":1}', auth: { type: "bearer", token: "{{token}}" } });
    expect(create?.params.map((p) => p.key)).toEqual(["q"]);
    expect(create?.headers[0]).toMatchObject({ key: "X-A", value: "1", enabled: true });
    const text = r.warnings.join("\n");
    expect(text).toMatch(/TRACE/);
    expect(text).toMatch(/Scripts and tests on 1 request were skipped/);
    expect(text).toMatch(/form-data/);
    expect(text).toMatch(/digest/);
    expect(r.environments).toHaveLength(1);
    expect(r.environments[0].vars[1]).toMatchObject({ key: "token", secret: true });
  });
  it("does not claim Postman collections", () => {
    expect(isBrunoCollection({ info: { name: "x" }, item: [] })).toBe(false);
    expect(isBrunoCollection({ info: {}, items: [] })).toBe(false);
    expect(isBrunoCollection(null)).toBe(false);
    expect(() => parseBrunoCollection({})).toThrow();
  });
});

describe("parseInsomnia", () => {
  const data = {
    _type: "export",
    __export_format: 4,
    resources: [
      { _id: "wrk_1", _type: "workspace", name: "Shop", parentId: null },
      { _id: "fld_1", _type: "request_group", name: "Orders", parentId: "wrk_1", metaSortKey: 1 },
      {
        _id: "req_2",
        _type: "request",
        name: "Second",
        method: "get",
        url: "{{ _.host }}/b",
        parentId: "fld_1",
        metaSortKey: 2,
      },
      {
        _id: "req_1",
        _type: "request",
        name: "First",
        method: "POST",
        url: "{{ _.host }}/a",
        parentId: "fld_1",
        metaSortKey: 1,
        parameters: [{ name: "q", value: "{{ _.q }}", disabled: true }],
        headers: [{ name: "X", value: "{% uuid 'v4' %}" }],
        body: { mimeType: "application/json", text: '{"id":"{{ _.id }}"}' },
        authentication: { type: "bearer", token: "{{ _.token }}" },
      },
      { _id: "req_3", _type: "request", metaSortKey: 3, name: "Form", method: "POST", url: "u", parentId: "wrk_1", body: { mimeType: "application/x-www-form-urlencoded", params: [{ name: "a", value: "1" }] }, authentication: { type: "oauth2" } },
      { _id: "req_4", _type: "request", metaSortKey: 4, name: "Trace", method: "TRACE", url: "u", parentId: "wrk_1" },
      { _id: "env_base", _type: "environment", name: "Base Environment", parentId: "wrk_1", data: { host: "https://h", nested: { a: 1, deep: { b: true } }, list: [1, 2] } },
      { _id: "env_sub", _type: "environment", name: "Staging", parentId: "env_base", data: { host: "https://s" } },
      { _id: "env_empty", _type: "environment", name: "Nothing", parentId: "env_base", data: {} },
    ],
  };

  it("builds a collection from the workspace, in sort order", () => {
    const r = parseInsomnia(data);
    expect(r.collections).toHaveLength(1);
    const c = r.collections[0];
    expect(c.name).toBe("Shop");
    const folder = c.items[0];
    expect(folder.kind === "folder" && folder.items.map((i) => (i.kind === "request" ? i.request.name : ""))).toEqual(["First", "Second"]);
    expect(countRequests(c.items)).toBe(4 - 1);
  });
  it("converts requests and variables", () => {
    const r = parseInsomnia(data);
    const folder = r.collections[0].items[0];
    const first = folder.kind === "folder" && folder.items[0].kind === "request" ? folder.items[0].request : null;
    expect(first).toMatchObject({ method: "POST", url: "{{host}}/a", bodyMode: "json", body: '{"id":"{{id}}"}', auth: { type: "bearer", token: "{{token}}" } });
    expect(first?.params[0]).toMatchObject({ key: "q", value: "{{q}}", enabled: false });
    const form = r.collections[0].items[1];
    expect(form.kind === "request" && form.request).toMatchObject({ bodyMode: "urlencoded", auth: { type: "none" } });
  });
  it("warns about what it could not convert", () => {
    const text = parseInsomnia(data).warnings.join("\n");
    expect(text).toMatch(/oauth2/);
    expect(text).toMatch(/TRACE/);
    expect(text).toMatch(/1 Insomnia template tag/);
  });
  it("turns environments into environments, flattening nested data and skipping empty ones", () => {
    const r = parseInsomnia(data);
    expect(r.environments.map((e) => e.name)).toEqual(["Shop base environment", "Staging"]);
    expect(r.environments[0].vars.map((v) => [v.key, v.value])).toEqual([["host", "https://h"], ["nested.a", "1"], ["nested.deep.b", "true"], ["list", "[1,2]"]]);
  });
  it("puts requests without a workspace in their own collection", () => {
    const r = parseInsomnia({ _type: "export", resources: [{ _id: "r", _type: "request", name: "Lone", method: "GET", url: "u", parentId: "gone" }] });
    expect(r.collections.map((c) => c.name)).toEqual(["Insomnia requests"]);
  });
  it("rejects other files and empty exports", () => {
    expect(() => parseInsomnia({ nope: 1 })).toThrow(/Insomnia/);
    expect(() => parseInsomnia({ _type: "export", resources: [] })).toThrow(/no requests/);
  });
});
