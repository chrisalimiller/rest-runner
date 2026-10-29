import { describe, expect, it } from "vitest";
import { matchVariables } from "./curlVariables";
import { emptyRow, newRequest } from "./defaults";
import type { KeyValue, RequestDef } from "./types";

const v = (key: string, value: string, extra: Partial<KeyValue> = {}): KeyValue => ({ id: key, key, value, enabled: true, ...extra });
const req = (p: Partial<RequestDef>): RequestDef => ({ ...newRequest(), ...p });

describe("matchVariables", () => {
  it("swaps the longest URL prefix", () => {
    const vars = [v("host", "https://sit.example.net"), v("baseUrl", "https://sit.example.net/api")];
    const r = matchVariables(req({ url: "https://sit.example.net/api/orders" }), vars);
    expect(r.def.url).toBe("{{baseUrl}}/orders");
    expect(r.swaps).toEqual([{ name: "baseUrl", where: "URL", secret: false, value: "https://sit.example.net/api" }]);
  });

  it("only matches at a boundary", () => {
    const vars = [v("host", "https://sit.example.net")];
    expect(matchVariables(req({ url: "https://sit.example.net2/x" }), vars).swaps).toEqual([]);
    expect(matchVariables(req({ url: "https://sit.example.net:8443/x" }), vars).def.url).toBe("{{host}}:8443/x");
    expect(matchVariables(req({ url: "https://sit.example.net" }), vars).def.url).toBe("{{host}}");
  });

  it("tolerates a trailing slash either way", () => {
    expect(matchVariables(req({ url: "https://a.test/api" }), [v("b", "https://a.test/api/")]).def.url).toBe("{{b}}");
    expect(matchVariables(req({ url: "https://a.test/api/x" }), [v("b", "https://a.test/api/")]).def.url).toBe("{{b}}x");
    expect(matchVariables(req({ url: "https://a.test/api/" }), [v("b", "https://a.test/api")]).def.url).toBe("{{b}}/");
  });

  it("skips short, disabled and already-templated values", () => {
    const vars = [v("flag", "yes"), v("off", "secret-value", { enabled: false }), v("t", "{{other}}-longer")];
    const def = req({ url: "https://a.test", params: [{ ...emptyRow(), key: "x", value: "yes" }, emptyRow()] });
    expect(matchVariables(def, vars)).toEqual({ def, swaps: [] });
  });

  it("swaps whole values in params, headers, forms and auth", () => {
    const vars = [v("token", "abc.def.ghi", { secret: true }), v("user", "ann-lee"), v("pass", "hunter22")];
    const def = req({
      url: "https://a.test",
      params: [{ ...emptyRow(), key: "u", value: "ann-lee" }, emptyRow()],
      headers: [{ ...emptyRow(), key: "X-Token", value: "abc.def.ghi" }, { ...emptyRow(), key: "Authorization", value: "Bearer abc.def.ghi" }, emptyRow()],
      formBody: [{ ...emptyRow(), key: "p", value: "hunter22" }, emptyRow()],
      auth: { type: "basic", username: "ann-lee", password: "hunter22" },
    });
    const r = matchVariables(def, vars);
    expect(r.def.params[0].value).toBe("{{user}}");
    expect(r.def.headers.map((h) => h.value)).toEqual(["{{token}}", "Bearer {{token}}", ""]);
    expect(r.def.formBody[0].value).toBe("{{pass}}");
    expect(r.def.auth).toEqual({ type: "basic", username: "{{user}}", password: "{{pass}}" });
    expect(r.swaps.filter((s) => s.name === "token").every((s) => s.secret)).toBe(true);
    expect(r.swaps).toHaveLength(6);
  });

  it("swaps a bearer token and does not match partially or by case", () => {
    const r = matchVariables(req({ auth: { type: "bearer", token: "abc.def.ghi" } }), [v("token", "abc.def.ghi", { secret: true })]);
    expect(r.def.auth).toEqual({ type: "bearer", token: "{{token}}" });
    const none = matchVariables(req({ params: [{ ...emptyRow(), key: "k", value: "ABC.DEF.GHI-x" }] }), [v("token", "abc.def.ghi")]);
    expect(none.swaps).toEqual([]);
  });

  it("leaves bodies alone", () => {
    const def = req({ method: "POST", bodyMode: "json", body: '{"token":"abc.def.ghi"}' });
    const r = matchVariables(def, [v("token", "abc.def.ghi")]);
    expect(r.def.body).toBe('{"token":"abc.def.ghi"}');
  });
});
