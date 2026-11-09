import { beforeEach, describe, expect, it } from "vitest";
import { CERTIFICATES_KEY, loadCertificates, resetCertificateCache, sanitizeCertificateEntry, saveCertificates, type CertificateEntry } from "./certificates";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const details = { subject: "CN=a", issuer: "CN=ca", notBefore: 1, notAfter: 2, sha256: "ab" };
const leaky = {
  id: "1",
  name: "Acme",
  enabled: true,
  patterns: ["a.example.com"],
  client: { format: "pem", separateKey: true, hasPassphrase: true, keyUnencrypted: false, details, passphrase: "hunter2", keyData: "PRIVATE" },
  files: { certData: "X", keyData: "PRIVATE", passphrase: "hunter2" },
  passphrase: "hunter2",
};

describe("certificate storage keeps secrets out of local storage", () => {
  beforeEach(() => {
    globalThis.localStorage = fakeStorage();
    resetCertificateCache();
  });

  it("drops fields outside the entry shape", () => {
    const clean = sanitizeCertificateEntry(leaky)!;
    expect(JSON.stringify(clean)).not.toMatch(/hunter2|PRIVATE|certData/);
    expect(clean.client?.details.sha256).toBe("ab");
  });

  it("drops entries without an id", () => {
    expect(sanitizeCertificateEntry({ name: "x" })).toBeNull();
    expect(sanitizeCertificateEntry(null)).toBeNull();
  });

  it("saveCertificates writes only the allowed fields", () => {
    saveCertificates([leaky as unknown as CertificateEntry]);
    const raw = localStorage.getItem(CERTIFICATES_KEY)!;
    expect(raw).not.toMatch(/hunter2|PRIVATE/);
    expect(JSON.parse(raw)[0].name).toBe("Acme");
  });

  it("loadCertificates migrates an old value and rewrites it clean", () => {
    localStorage.setItem(CERTIFICATES_KEY, JSON.stringify([leaky]));
    const entries = loadCertificates();
    expect(JSON.stringify(entries)).not.toMatch(/hunter2|PRIVATE/);
    expect(localStorage.getItem(CERTIFICATES_KEY)).not.toMatch(/hunter2|PRIVATE/);
    expect(entries[0].id).toBe("1");
  });
});
