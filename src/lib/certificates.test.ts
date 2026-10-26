import { describe, expect, it } from "vitest";
import {
  expiryState,
  findDuplicatePatterns,
  explainTlsError,
  formatFingerprint,
  matchCertificate,
  parsePattern,
  patternError,
  tlsFor,
  type CertificateEntry,
} from "./certificates";

const details = { subject: "CN=x", issuer: "CN=ca", notBefore: 0, notAfter: 4_000_000_000, sha256: "ab".repeat(32) };

function entry(id: string, patterns: string[], extra: Partial<CertificateEntry> = {}): CertificateEntry {
  return {
    id,
    name: id,
    enabled: true,
    patterns,
    client: { format: "pem", separateKey: true, hasPassphrase: false, keyUnencrypted: true, details },
    ...extra,
  };
}

const winner = (url: string, entries: CertificateEntry[]) => matchCertificate(url, entries).client?.id ?? null;

describe("parsePattern", () => {
  it("splits host, port and path, ignoring a scheme", () => {
    expect(parsePattern("https://API.Acme.com:8443/v2/")).toEqual({ host: "api.acme.com", wildcard: false, port: 8443, path: "v2" });
    expect(parsePattern("*.acme.com")).toEqual({ host: "acme.com", wildcard: true, port: null, path: "" });
  });
  it("normalizes IDN hosts to punycode", () => {
    expect(parsePattern("bücher.example")).toMatchObject({ host: "xn--bcher-kva.example" });
  });
  it("explains what is wrong", () => {
    expect(patternError("")).toBe("Empty pattern");
    expect(patternError("http://a.com")).toMatch(/https/);
    expect(patternError("a.com:99999")).toMatch(/Port/);
    expect(patternError("a*.com")).toMatch(/Wildcards/);
    expect(patternError("*.10.0.0.1")).toMatch(/IP/);
    expect(patternError("a.com/x?y=1")).toMatch(/spaces/);
    expect(patternError("*.acme.com:8443/v2")).toBeNull();
  });
});

describe("matchCertificate", () => {
  it("matches a host on any port and any path", () => {
    const e = [entry("a", ["api.acme.com"])];
    expect(winner("https://api.acme.com/anything", e)).toBe("a");
    expect(winner("https://api.acme.com:9443/x", e)).toBe("a");
    expect(winner("https://v2.api.acme.com/", e)).toBeNull();
    expect(winner("https://API.ACME.COM/", e)).toBe("a");
  });
  it("wildcards match subdomains but not the bare domain", () => {
    const e = [entry("a", ["*.acme.com"])];
    expect(winner("https://a.acme.com", e)).toBe("a");
    expect(winner("https://a.b.acme.com", e)).toBe("a");
    expect(winner("https://acme.com", e)).toBeNull();
    expect(winner("https://notacme.com", e)).toBeNull();
  });
  it("ports: the default https port counts as 443", () => {
    const e = [entry("a", ["api.acme.com:8443"]), entry("b", ["api.acme.com:443"])];
    expect(winner("https://api.acme.com:8443/", e)).toBe("a");
    expect(winner("https://api.acme.com/", e)).toBe("b");
  });
  it("path prefixes match whole segments", () => {
    const e = [entry("a", ["api.acme.com/v2"])];
    expect(winner("https://api.acme.com/v2", e)).toBe("a");
    expect(winner("https://api.acme.com/v2/users", e)).toBe("a");
    expect(winner("https://api.acme.com/v20", e)).toBeNull();
    expect(winner("https://api.acme.com/v1", e)).toBeNull();
  });
  it("IP addresses match only exactly", () => {
    const e = [entry("a", ["10.0.0.5:8443"])];
    expect(winner("https://10.0.0.5:8443/", e)).toBe("a");
    expect(winner("https://10.0.0.6:8443/", e)).toBeNull();
  });
  it("the most specific wins: exact host, then longer suffix, then port, then path, then list order", () => {
    const e = [
      entry("wild", ["*.acme.com"]),
      entry("longer", ["*.api.acme.com"]),
      entry("exact", ["x.api.acme.com"]),
      entry("withport", ["x.api.acme.com:443"]),
      entry("withpath", ["x.api.acme.com:443/v2"]),
    ];
    expect(winner("https://x.api.acme.com/v2/a", e)).toBe("withpath");
    expect(winner("https://x.api.acme.com/v1", e)).toBe("withport");
    expect(winner("https://x.api.acme.com:444/", e.slice(0, 3))).toBe("exact");
    expect(winner("https://y.api.acme.com/", e.slice(0, 3))).toBe("longer");
    expect(winner("https://z.acme.com/", e.slice(0, 3))).toBe("wild");
  });
  it("breaks ties by list order and reports them", () => {
    const e = [entry("first", ["a.com"]), entry("second", ["a.com"])];
    const m = matchCertificate("https://a.com", e);
    expect(m.client?.id).toBe("first");
    expect(m.ties.map((t) => t.id)).toEqual(["second"]);
  });
  it("skips disabled entries and entries with a bad pattern", () => {
    expect(winner("https://a.com", [entry("a", ["a.com"], { enabled: false })])).toBeNull();
    expect(winner("https://a.com", [entry("a", ["a*.com", "a.com"])])).toBe("a");
  });
  it("does not pick a certificate for http, but flags it", () => {
    const m = matchCertificate("http://a.com/", [entry("a", ["a.com"])]);
    expect(m.client).toBeNull();
    expect(m.insecure).toBe(true);
  });
  it("gives nothing while the URL still has placeholders or is not a URL", () => {
    const e = [entry("a", ["a.com"])];
    expect(winner("https://{{host}}/x", e)).toBeNull();
    expect(winner("not a url", e)).toBeNull();
  });
  it("collects the CAs of every matching entry", () => {
    const ca = { count: 1, details };
    const e = [entry("a", ["*.acme.com"], { client: undefined, ca }), entry("b", ["api.acme.com"], { ca })];
    const m = matchCertificate("https://api.acme.com", e);
    expect(m.client?.id).toBe("b");
    expect(m.cas.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("findDuplicatePatterns", () => {
  it("names the other entries that share a pattern", () => {
    const e = [entry("a", ["API.acme.com", "b.com"]), entry("b", ["https://api.acme.com/"]), entry("c", ["b.com:8443"])];
    expect(findDuplicatePatterns(e)).toEqual({ a: ["b"], b: ["a"] });
  });
  it("ignores disabled entries and CA-only entries", () => {
    const e = [entry("a", ["a.com"]), entry("b", ["a.com"], { enabled: false }), entry("c", ["a.com"], { client: undefined })];
    expect(findDuplicatePatterns(e)).toEqual({});
  });
});

describe("tlsFor", () => {
  it("returns null when nothing applies", () => {
    expect(tlsFor("https://other.test", [entry("a", ["a.com"])])).toBeNull();
  });
  it("describes the client and CAs, and records the certificate used", () => {
    const ca = { count: 1, details };
    const out = tlsFor("https://a.com", [entry("a", ["a.com"], { ca, caOnly: true })])!;
    expect(out.tls).toEqual({ certId: "a", caIds: ["a"], caOnly: true });
    expect(out.used).toEqual({ id: "a", name: "a", sha256: details.sha256 });
  });
  it("can leave the client certificate out but keep trusting the CA", () => {
    const ca = { count: 1, details };
    const out = tlsFor("https://a.com", [entry("a", ["a.com"], { ca })], true)!;
    expect(out.tls.certId).toBeUndefined();
    expect(out.tls.caIds).toEqual(["a"]);
    expect(out.used).toBeUndefined();
    expect(tlsFor("https://a.com", [entry("a", ["a.com"])], true)).toBeNull();
  });
});

describe("helpers", () => {
  it("expiryState", () => {
    const now = Date.UTC(2026, 9, 26);
    expect(expiryState(now / 1000 - 1, now)).toBe("expired");
    expect(expiryState(now / 1000 + 10 * 86400, now)).toBe("soon");
    expect(expiryState(now / 1000 + 90 * 86400, now)).toBe("ok");
  });
  it("formatFingerprint", () => {
    expect(formatFingerprint("abcd01")).toBe("AB:CD:01");
  });
  it("explainTlsError adds a hint only when a certificate is the likely cause", () => {
    const ctx = { host: "api.acme.com" };
    expect(explainTlsError("received fatal alert: CertificateRequired", ctx)).toMatch(/none matched api\.acme\.com/);
    expect(explainTlsError("x", { ...ctx, usedCertificate: "Acme" })).toBe("x");
    expect(explainTlsError("peer sent no certificates", { ...ctx, usedCertificate: "Acme" })).toMatch(/did not accept the certificate "Acme"/);
    expect(explainTlsError("invalid peer certificate: UnknownIssuer", ctx)).toMatch(/add the CA file/);
    expect(explainTlsError("connection refused", ctx)).toBe("connection refused");
  });
});
