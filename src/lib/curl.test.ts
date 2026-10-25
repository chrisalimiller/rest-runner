import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import { bashQuote, cmdQuote, requestToCurl } from "./curl";
import type { KeyValue, RequestDef } from "./types";

const row = (key: string, value: string, enabled = true): KeyValue => ({ id: key, key, value, enabled });
const req = (p: Partial<RequestDef>): RequestDef => ({ ...newRequest(), ...p });

describe("bashQuote", () => {
  it("leaves simple words alone and single-quotes the rest", () => {
    expect(bashQuote("https://a.com/x")).toBe("https://a.com/x");
    expect(bashQuote("a b")).toBe("'a b'");
    expect(bashQuote("it's")).toBe("'it'\\''s'");
    expect(bashQuote("")).toBe("''");
  });
});

describe("cmdQuote", () => {
  it("escapes quotes for curl.exe and keeps cmd specials inside quotes", () => {
    expect(cmdQuote("a b")).toBe('"a b"');
    expect(cmdQuote("http://a.com/?x=1&y=2")).toBe('"http://a.com/?x=1&y=2"');
    expect(cmdQuote('{"a":1}')).toBe('"{\\"a\\":1}"');
  });

  it("puts ^ before specials cmd would see outside quotes", () => {
    // After the first \" cmd thinks the quotes closed, so the & needs a caret.
    expect(cmdQuote('{"a":"x&y"}')).toBe('"{\\"a\\":\\"x^&y\\"}"');
  });

  it("doubles backslashes before a quote and at the end", () => {
    expect(cmdQuote('a\\"b')).toBe('"a\\\\\\"b"');
    expect(cmdQuote("C:\\dir\\")).toBe('"C:\\dir\\\\"');
  });
});

describe("requestToCurl", () => {
  it("builds a GET with filled-in params and headers", () => {
    const r = requestToCurl(
      req({ url: "{{base}}/users", params: [row("q", "{{name}}")], headers: [row("Accept", "application/json"), row("X-Off", "1", false)] }),
      { base: "https://api.test", name: "Ann Lee" },
      "bash",
    );
    expect(r.command).toBe("curl --location 'https://api.test/users?q=Ann%20Lee' \\\n  --header 'Accept: application/json'");
    expect(r.unresolved).toEqual([]);
  });

  it("adds method, auth, content type and body", () => {
    const r = requestToCurl(
      req({ method: "POST", url: "https://a.com", bodyMode: "json", body: '{"name": "{{n}}"}', auth: { type: "bearer", token: "{{tok}}" } }),
      { n: "O'Neil", tok: "abc" },
      "bash",
    );
    expect(r.command).toBe(
      [
        "curl --location --request POST https://a.com",
        "--header 'Authorization: Bearer abc'",
        "--header 'Content-Type: application/json'",
        `--data-raw '{"name": "O'\\''Neil"}'`,
      ].join(" \\\n  "),
    );
  });

  it("lists placeholders with no value", () => {
    const r = requestToCurl(req({ url: "https://a.com/{{id}}", headers: [row("X-Key", "{{key}}")] }), {}, "bash");
    expect(r.unresolved).toEqual(["id", "key"]);
  });

  it("uses --head for HEAD and writes empty headers with a semicolon", () => {
    const r = requestToCurl(req({ method: "HEAD", url: "https://a.com", headers: [row("X-Empty", "")] }), {}, "bash");
    expect(r.command).toBe("curl --location --head https://a.com \\\n  --header 'X-Empty;'");
  });

  it("puts a multi-line JSON body on one line for cmd", () => {
    const r = requestToCurl(req({ method: "POST", url: "https://a.com", bodyMode: "json", body: '{\n  "a": 1\n}' }), {}, "cmd");
    expect(r.command).toBe('curl --location --request POST "https://a.com" ^\n  --header "Content-Type: application/json" ^\n  --data-raw "{\\"a\\":1}"');
    expect(r.notes.length).toBe(1);
  });

  it("notes a pre-request script", () => {
    const r = requestToCurl(req({ url: "https://a.com", preScript: "rr.vars.set('a','1')" }), {}, "bash");
    expect(r.notes.some((n) => n.includes("pre-request script"))).toBe(true);
  });
});
