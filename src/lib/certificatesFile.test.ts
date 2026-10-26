import { describe, expect, it, vi } from "vitest";
import type { CertificateEntry } from "./certificates";
import { certificatesForExport, describeCertificateImport, fingerprintOf, importCertificates } from "./certificatesFile";
import { newEnvironment } from "./environments";
import { importWorkspace, toWorkspaceFile } from "./workspace";

const details = (sha256: string) => ({ subject: "CN=x", issuer: "CN=ca", notBefore: 0, notAfter: 4_000_000_000, sha256 });
const entry = (id: string, sha: string, extra: Partial<CertificateEntry> = {}): CertificateEntry => ({
  id,
  name: id,
  enabled: true,
  patterns: ["api.acme.com"],
  client: { format: "pem", separateKey: false, hasPassphrase: false, keyUnencrypted: true, details: details(sha) },
  ...extra,
});

describe("certificatesForExport", () => {
  it("writes names, patterns and fingerprints only, and skips entries still waiting for files", async () => {
    const out = await certificatesForExport([entry("a", "aa"), entry("b", "bb", { needsFile: true })], false);
    expect(out.map((c) => c.id)).toEqual(["a"]);
    expect(JSON.stringify(out)).not.toContain("files");
  });
});

describe("workspace file version 4", () => {
  it("carries certificates, and older files without them still import", () => {
    const text = toWorkspaceFile([], [newEnvironment("Dev")], { certificates: [entry("a", "aa")] });
    const file = JSON.parse(text);
    expect(file.version).toBe(4);
    expect(file.certificates).toHaveLength(1);
    expect(importWorkspace(text, { collections: [], environments: [], suites: [], flows: [] }).environments).toHaveLength(1);
    const v3 = JSON.stringify({ app: "rest-runner", version: 3, collections: [], environments: [], suites: [], flows: [] });
    expect(importWorkspace(v3, { collections: [], environments: [], suites: [], flows: [] }).environments).toEqual([]);
    expect(JSON.parse(toWorkspaceFile([], [], {})).certificates).toBeUndefined();
  });
});

describe("importCertificates", () => {
  const noFiles = vi.fn();

  it("adds new entries disabled and marked as needing their files", async () => {
    const r = await importCertificates([entry("x", "aa")], [], noFiles);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ enabled: false, needsFile: true, name: "x" });
    expect(r.entries[0].id).not.toBe("x");
    expect(r.needFiles).toEqual(["x"]);
    expect(noFiles).not.toHaveBeenCalled();
  });

  it("updates the entry with the same fingerprint instead of duplicating it", async () => {
    const mine = entry("local", "aa", { name: "Old name", patterns: ["old.com"], enabled: false });
    const r = await importCertificates([entry("remote", "aa", { name: "New name", patterns: ["new.com"] })], [mine], noFiles);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ id: "local", name: "New name", patterns: ["new.com"], enabled: true });
    expect(r).toMatchObject({ added: 0, updated: 1 });
  });

  it("does not switch on an entry that is still waiting for its files", async () => {
    const waiting = entry("w", "aa", { enabled: false, needsFile: true });
    const r = await importCertificates([entry("remote", "aa")], [waiting], noFiles);
    expect(r.entries[0]).toMatchObject({ enabled: false, needsFile: true });
  });

  it("imports the files when the export included them", async () => {
    const importFiles = vi.fn().mockResolvedValue({ client: entry("z", "cc").client });
    const incoming = { ...entry("remote", "cc"), files: { certData: "QUJD", certName: "client.pem", passphrase: "pw" } };
    const r = await importCertificates([incoming], [], importFiles);
    expect(importFiles).toHaveBeenCalledWith(expect.objectContaining({ certData: "QUJD", certName: "client.pem", passphrase: "pw" }));
    expect(r.entries[0]).toMatchObject({ enabled: true, name: "remote" });
    expect(r.entries[0].needsFile).toBeUndefined();
    expect(r.needFiles).toEqual([]);
  });

  it("falls back to needing files, with a warning, when the files cannot be imported", async () => {
    const importFiles = vi.fn().mockRejectedValue("The passphrase may be wrong.");
    const r = await importCertificates([{ ...entry("remote", "cc"), files: { certData: "QUJD" } }], [], importFiles);
    expect(r.entries[0]).toMatchObject({ needsFile: true, enabled: false });
    expect(r.warnings[0]).toMatch(/passphrase may be wrong/);
  });

  it("ignores junk", async () => {
    expect((await importCertificates("nope", [], noFiles)).entries).toEqual([]);
    expect((await importCertificates([{ id: 1 }, null], [], noFiles)).entries).toEqual([]);
  });
});

describe("helpers", () => {
  it("fingerprintOf prefers the client certificate, then the CA", () => {
    expect(fingerprintOf(entry("a", "aa"))).toBe("aa");
    expect(fingerprintOf({ client: undefined, ca: { count: 1, details: details("bb") } })).toBe("bb");
    expect(fingerprintOf({})).toBeNull();
  });
  it("describeCertificateImport", () => {
    expect(describeCertificateImport({ entries: [], added: 1, updated: 1, needFiles: ["Acme"], warnings: [] })).toBe(
      'certificates: 1 added, 1 updated. "Acme" needs its files: import the same certificate under Certificates to finish.',
    );
  });
});
