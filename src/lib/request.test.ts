import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import { appendQuery, normalizeUrl, prepareRequest } from "./request";
import type { KeyValue, RequestDef } from "./types";

const row = (key: string, value: string, enabled = true): KeyValue => ({ id: key, key, value, enabled });

function req(p: Partial<RequestDef>): RequestDef {
  return { ...newRequest(), ...p };
}

describe("normalizeUrl", () => {
  it("adds http:// when missing", () => {
    expect(normalizeUrl("localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(normalizeUrl("https://a.com")).toBe("https://a.com");
  });
});

describe("appendQuery", () => {
  it("handles existing query strings and fragments", () => {
    expect(appendQuery("http://a.com/x", [["q", "a b"]])).toBe("http://a.com/x?q=a%20b");
    expect(appendQuery("http://a.com/x?y=1", [["q", "2"]])).toBe("http://a.com/x?y=1&q=2");
    expect(appendQuery("http://a.com/x?", [["q", "2"]])).toBe("http://a.com/x?q=2");
    expect(appendQuery("http://a.com/x#top", [["q", "2"]])).toBe("http://a.com/x?q=2#top");
  });
});

describe("prepareRequest", () => {
  it("skips disabled and blank rows", () => {
    const p = prepareRequest(
      req({ url: "https://a.com", params: [row("a", "1"), row("b", "2", false), row("", "x")], headers: [row("X-One", "1"), row("X-Two", "2", false)] }),
    );
    expect(p.url).toBe("https://a.com?a=1");
    expect(p.headers).toEqual([["X-One", "1"]]);
  });

  it("fills placeholders everywhere", () => {
    const p = prepareRequest(
      req({
        method: "POST",
        url: "https://a.com/users/{{id}}",
        params: [row("v", "{{ver}}")],
        headers: [row("X-Tenant", "{{tenant}}")],
        bodyMode: "json",
        body: '{"name":"{{name}}","missing":"{{nope}}"}',
      }),
      { id: "42", ver: "2", tenant: "acme", name: "Ann" },
    );
    expect(p.url).toBe("https://a.com/users/42?v=2");
    expect(p.headers).toContainEqual(["X-Tenant", "acme"]);
    expect(p.body).toBe('{"name":"Ann","missing":"{{nope}}"}');
    expect(p.headers).toContainEqual(["Content-Type", "application/json"]);
  });

  it("does not override a user Content-Type", () => {
    const p = prepareRequest(req({ method: "POST", url: "a.com", headers: [row("content-type", "application/vnd+json")], bodyMode: "json", body: "{}" }));
    expect(p.headers.filter(([k]) => k.toLowerCase() === "content-type")).toEqual([["content-type", "application/vnd+json"]]);
  });

  it("drops the body for GET", () => {
    const p = prepareRequest(req({ method: "GET", url: "a.com", bodyMode: "json", body: "{}" }));
    expect(p.body).toBeUndefined();
    expect(p.headers).toEqual([]);
  });

  it("encodes urlencoded bodies", () => {
    const p = prepareRequest(req({ method: "POST", url: "a.com", bodyMode: "urlencoded", formBody: [row("a", "1 2"), row("b", "&")] }));
    expect(p.body).toBe("a=1%202&b=%26");
    expect(p.headers).toContainEqual(["Content-Type", "application/x-www-form-urlencoded"]);
  });

  it("applies bearer, basic and API key auth", () => {
    expect(prepareRequest(req({ url: "a.com", auth: { type: "bearer", token: "{{t}}" } }), { t: "abc" }).headers).toEqual([
      ["Authorization", "Bearer abc"],
    ]);
    expect(prepareRequest(req({ url: "a.com", auth: { type: "basic", username: "user", password: "pässword" } })).headers).toEqual([
      ["Authorization", "Basic dXNlcjpww6Rzc3dvcmQ="],
    ]);
    expect(prepareRequest(req({ url: "a.com", auth: { type: "apikey", key: "X-Key", value: "k", addTo: "header" } })).headers).toEqual([
      ["X-Key", "k"],
    ]);
    expect(prepareRequest(req({ url: "a.com", auth: { type: "apikey", key: "api_key", value: "k", addTo: "query" } })).url).toBe(
      "http://a.com?api_key=k",
    );
  });

  it("lets a manual Authorization header win over auth settings", () => {
    const p = prepareRequest(req({ url: "a.com", headers: [row("Authorization", "Custom x")], auth: { type: "bearer", token: "t" } }));
    expect(p.headers).toEqual([["Authorization", "Custom x"]]);
  });
});
