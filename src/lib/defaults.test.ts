import { describe, expect, it } from "vitest";
import { completeRequest } from "./defaults";

describe("completeRequest", () => {
  it("rejects values that are not requests", () => {
    for (const bad of [null, 5, "x", [], {}, { url: 3 }]) expect(completeRequest(bad)).toBeNull();
  });

  it("fills missing and broken parts with defaults", () => {
    const r = completeRequest({ url: "https://x", method: "NOPE", params: "bad", headers: [null, { key: "a", value: "b" }], auth: { type: "apikey" } })!;
    expect(r.url).toBe("https://x");
    expect(r.method).toBe("GET");
    expect(r.params).toHaveLength(1);
    expect(r.headers).toHaveLength(1);
    expect(r.headers[0]).toMatchObject({ key: "a", value: "b", enabled: true });
    expect(typeof r.headers[0].id).toBe("string");
    expect(r.formBody).toHaveLength(1);
    expect(r.bodyMode).toBe("none");
    expect(r.auth).toEqual({ type: "apikey", key: "", value: "", addTo: "header" });
  });

  it("keeps a valid request as it is", () => {
    const req = { id: "r1", name: "Get", method: "POST", url: "u", params: [{ id: "p", key: "k", value: "v", enabled: false }], headers: [], bodyMode: "json", body: "{}", formBody: [], auth: { type: "bearer", token: "t" }, preScript: "x" };
    const r = completeRequest(req)!;
    expect(r).toMatchObject({ id: "r1", name: "Get", method: "POST", bodyMode: "json", body: "{}", auth: { type: "bearer", token: "t" }, preScript: "x" });
    expect(r.params[0]).toEqual(req.params[0]);
  });
});
