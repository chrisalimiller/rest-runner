import { describe, expect, it } from "vitest";
import { newRequest } from "../defaults";
import { sameRequest } from "./requestSame";

describe("sameRequest", () => {
  const saved = { ...newRequest(), name: "Get user", url: "https://x.test/u", headers: [{ id: "h", key: "A", value: "1", enabled: true }] } as ReturnType<typeof newRequest>;

  it("ignores the id and key order", () => {
    const copy = JSON.parse(JSON.stringify({ ...saved, id: "other" }));
    const reordered = Object.fromEntries(Object.entries(copy).reverse()) as unknown as typeof saved;
    expect(sameRequest(reordered, saved)).toBe(true);
  });
  it("treats missing scripts and noCertificate as empty", () => {
    const { preScript: _a, postScript: _b, noCertificate: _c, ...old } = saved;
    void _a; void _b; void _c;
    expect(sameRequest({ ...old } as typeof saved, { ...saved, preScript: "", postScript: "", noCertificate: false })).toBe(true);
  });
  it("sees a changed url, header or script", () => {
    expect(sameRequest({ ...saved, id: "c", url: "https://x.test/v" }, saved)).toBe(false);
    expect(sameRequest({ ...saved, id: "c", headers: [] }, saved)).toBe(false);
    expect(sameRequest({ ...saved, id: "c", preScript: "rr.set('a',1)" }, saved)).toBe(false);
  });
});
