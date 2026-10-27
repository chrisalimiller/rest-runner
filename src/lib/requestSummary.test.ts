import { describe, expect, it } from "vitest";
import { emptyRow, newRequest } from "./defaults";
import { prepareRequest } from "./request";
import { authSummary, bodySummary, countsLabel, loadDetailsState, paramsText, requestDetailsSummary, requestSummaryLine, resolvedUrl, rowCounts, splitPlaceholders } from "./requestSummary";
import type { KeyValue, RequestDef } from "./types";

const row = (key: string, value: string, enabled = true): KeyValue => ({ id: key + value, key, value, enabled });
const req = (p: Partial<RequestDef>): RequestDef => ({ ...newRequest(), ...p });

describe("section summaries", () => {
  it("counts named rows on and off", () => {
    const rows = [row("a", "1"), row("b", "2", false), row("", "")];
    expect(rowCounts(rows)).toEqual({ on: 1, off: 1 });
    expect(countsLabel(rowCounts(rows))).toBe("1 on · 1 off");
    expect(countsLabel({ on: 3, off: 0 })).toBe("3 on");
    expect(countsLabel({ on: 0, off: 0 })).toBe("");
  });

  it("writes enabled params like a query string", () => {
    expect(paramsText([row("fields", "id,status"), row("x", "1", false), row("flag", "")])).toBe("fields=id,status&flag");
  });

  it("summarizes auth", () => {
    expect(authSummary({ type: "bearer", token: "{{token}}" })).toEqual({ label: "Bearer", value: "{{token}}" });
    expect(authSummary({ type: "basic", username: "me", password: "x" })).toEqual({ label: "Basic", value: "me" });
    expect(authSummary({ type: "apikey", key: "X-Key", value: "v", addTo: "query" }).label).toBe("API key in query");
    expect(authSummary({ type: "none" })).toEqual({ label: "None", value: "" });
  });

  it("says whether a JSON body is valid", () => {
    expect(bodySummary({ bodyMode: "json", body: '{"a": {{n}}}' })).toEqual({ label: "Raw JSON", status: "valid" });
    expect(bodySummary({ bodyMode: "json", body: '{"a": ' })).toEqual({ label: "Raw JSON", status: "invalid" });
    expect(bodySummary({ bodyMode: "text", body: "hi" })).toEqual({ label: "Raw text", status: null });
  });

  it("builds the one-line case summary", () => {
    const def = req({
      method: "POST",
      params: [row("a", "1")],
      headers: [row("A", "1"), row("B", "2"), row("C", "3")],
      auth: { type: "bearer", token: "t" },
      bodyMode: "json",
    });
    expect(requestSummaryLine(def)).toBe("Params 1 · Bearer · Headers 3 · JSON body");
    expect(requestSummaryLine(req({}))).toBe("No params, auth, headers or body");
  });
});

describe("resolvedUrl", () => {
  it("matches what prepareRequest sends, query params included", () => {
    const def = req({ url: "{{baseUrl}}/tickets", params: [row("fields", "id,status"), row("off", "1", false)], auth: { type: "apikey", key: "k", value: "{{key}}", addTo: "query" } });
    const vars = { baseUrl: "https://sit.example.net", key: "abc" };
    expect(resolvedUrl(def, vars)).toBe(prepareRequest(def, vars).url);
    expect(resolvedUrl(def, vars)).toBe("https://sit.example.net/tickets?fields=id%2Cstatus&k=abc");
  });

  it("keeps placeholders with no value as written", () => {
    expect(resolvedUrl(req({ url: "https://a.com/{{id}}" }), {})).toBe("https://a.com/{{id}}");
  });

  it("is empty with no URL", () => {
    expect(resolvedUrl(req({ url: "  " }), {})).toBe("");
  });
});

describe("splitPlaceholders", () => {
  it("finds written and URL-encoded placeholders", () => {
    expect(splitPlaceholders("a/{{id}}?q=%7B%7Bx%7D%7D")).toEqual([
      { text: "a/", placeholder: false },
      { text: "{{id}}", placeholder: true },
      { text: "?q=", placeholder: false },
      { text: "%7B%7Bx%7D%7D", placeholder: true },
    ]);
    expect(splitPlaceholders("plain")).toEqual([{ text: "plain", placeholder: false }]);
  });

  it("flags each placeholder as resolved or not when vars are given", () => {
    expect(splitPlaceholders("{{a}}/%7B%7Bb%7D%7D/{{ c }}", { a: "1", c: "" }).filter((p) => p.placeholder).map((p) => p.resolved)).toEqual([true, false, true]);
  });
});

describe("requestDetailsSummary", () => {
  const text = (def: RequestDef, vars?: Record<string, string>) => requestDetailsSummary(def, vars).map((i) => i.text);

  it("counts enabled rows, singular and plural", () => {
    expect(text(req({ params: [row("a", "1")], headers: [row("h", "1"), row("g", "2"), row("k", "3")] }))).toEqual(["1 param", "No auth", "3 headers"]);
  });

  it("does not count disabled or unnamed rows", () => {
    const def = req({ params: [row("a", "1"), row("b", "2", false), emptyRow()], headers: [row("h", "1", false)] });
    expect(text(def)).toEqual(["1 param", "No auth", "No headers"]);
  });

  it("says no params, no auth and no headers for an empty request, and nothing about scripts", () => {
    expect(requestDetailsSummary(req({})).map((i) => `${i.id}:${i.text}`)).toEqual(["params:No params", "auth:No auth", "headers:No headers"]);
  });

  it("shows the auth type with its value", () => {
    expect(text(req({ auth: { type: "bearer", token: "{{token}}" } }))[1]).toBe("Bearer {{token}}");
    expect(text(req({ auth: { type: "basic", username: "ada", password: "x" } }))[1]).toBe("Basic ada");
  });

  it("marks an auth placeholder with no value as missing", () => {
    const def = req({ auth: { type: "bearer", token: "{{token}}" } });
    expect(requestDetailsSummary(def, {})[1].tone).toBe("missing");
    expect(requestDetailsSummary(def, { token: "abc" })[1].tone).toBeUndefined();
    expect(requestDetailsSummary(def)[1].tone).toBeUndefined();
  });

  it("names the scripts", () => {
    const last = (p: Partial<RequestDef>) => requestDetailsSummary(req(p)).at(-1);
    expect(last({ preScript: "rr.log(1)" })).toEqual({ id: "scripts", text: "before-script" });
    expect(last({ postScript: "rr.log(1)" })).toEqual({ id: "scripts", text: "after-script" });
    expect(last({ preScript: "a", postScript: "b" })).toEqual({ id: "scripts", text: "both scripts" });
    expect(last({ preScript: "  ", postScript: "" })?.id).toBe("headers");
  });
});

describe("loadDetailsState", () => {
  it("is closed on Params when nothing is stored", () => {
    expect(loadDetailsState(null)).toEqual({ open: false, tab: "params" });
    expect(loadDetailsState(undefined)).toEqual({ open: false, tab: "params" });
  });

  it("reads a stored state", () => {
    expect(loadDetailsState({ open: true, tab: "headers" })).toEqual({ open: true, tab: "headers" });
  });

  it("falls back for a bad value or an unknown tab", () => {
    expect(loadDetailsState("oops")).toEqual({ open: false, tab: "params" });
    expect(loadDetailsState(42)).toEqual({ open: false, tab: "params" });
    expect(loadDetailsState({ open: "yes", tab: "body" })).toEqual({ open: false, tab: "params" });
    expect(loadDetailsState({ open: true, tab: "nope" })).toEqual({ open: true, tab: "params" });
  });
});
