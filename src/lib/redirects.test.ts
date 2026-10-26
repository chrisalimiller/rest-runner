import { describe, expect, it } from "vitest";
import { nextHop } from "./redirects";
import type { PreparedRequest } from "./types";

const post: PreparedRequest = {
  method: "POST",
  url: "https://api.acme.com/a/b",
  headers: [
    ["Content-Type", "application/json"],
    ["Authorization", "Bearer x"],
  ],
  body: "{}",
};
const location = (value: string): [string, string][] => [["Location", value]];

describe("nextHop", () => {
  it("ignores responses that are not redirects or have no Location", () => {
    expect(nextHop(post, 200, location("/x"))).toBeNull();
    expect(nextHop(post, 302, [])).toBeNull();
    expect(nextHop(post, 304, location("/x"))).toBeNull();
  });

  it("turns POST into GET without a body on 302 and drops content headers", () => {
    const hop = nextHop(post, 302, location("/next"))!;
    expect(hop.method).toBe("GET");
    expect(hop.url).toBe("https://api.acme.com/next");
    expect(hop.body).toBeUndefined();
    expect(hop.headers).toEqual([["Authorization", "Bearer x"]]);
  });

  it("keeps method and body on 307 and 308", () => {
    for (const status of [307, 308]) {
      const hop = nextHop(post, status, location("../c"))!;
      expect(hop.method).toBe("POST");
      expect(hop.body).toBe("{}");
      expect(hop.url).toBe("https://api.acme.com/c");
    }
  });

  it("keeps GET and HEAD as they are on 301, and HEAD on 303", () => {
    const get: PreparedRequest = { method: "GET", url: "https://a.test/", headers: [] };
    expect(nextHop(get, 301, location("/b"))!.method).toBe("GET");
    expect(nextHop({ ...get, method: "HEAD" }, 303, location("/b"))!.method).toBe("HEAD");
    expect(nextHop({ ...get, method: "PUT", body: "x" }, 303, location("/b"))!.method).toBe("GET");
  });

  it("drops credentials when the origin changes, and only then", () => {
    const other = nextHop(post, 307, location("https://elsewhere.test/x"))!;
    expect(other.headers).toEqual([["Content-Type", "application/json"]]);
    const port = nextHop(post, 307, location("https://api.acme.com:8443/x"))!;
    expect(port.headers.some(([n]) => n === "Authorization")).toBe(false);
    const same = nextHop(post, 307, location("/x"))!;
    expect(same.headers.some(([n]) => n === "Authorization")).toBe(true);
  });

  it("returns null for a Location that is not a URL", () => {
    expect(nextHop(post, 302, location("http://"))).toBeNull();
  });
});
