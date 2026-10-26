/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BATCH_OPTIONS } from "./batch";
import type { CertificateEntry } from "./certificates";
import { requestToCurl } from "./curl";
import { newRequest } from "./defaults";
import { buildScript, scriptExportNotes, type ScriptExportInput } from "./scriptExport";

const details = { subject: "CN=x", issuer: "CN=ca", notBefore: 0, notAfter: 4_000_000_000, sha256: "ab".repeat(32) };
const pem: CertificateEntry = {
  id: "a",
  name: "Acme staging",
  enabled: true,
  patterns: ["api.acme.com"],
  client: { format: "pem", separateKey: true, hasPassphrase: true, keyUnencrypted: false, details },
  ca: { count: 1, details },
};
const pfx: CertificateEntry = { ...pem, id: "b", client: { ...pem.client!, format: "pkcs12", separateKey: false }, ca: undefined };
const def = { ...newRequest(), url: "https://api.acme.com/v2/users" };

describe("Copy as cURL with certificates", () => {
  it("adds --cert, --key, --pass and --cacert with placeholder paths (Bash)", () => {
    const { command, notes } = requestToCurl(def, {}, "bash", [pem]);
    expect(command).toContain("--cert /path/to/acme-staging.pem");
    expect(command).toContain("--key /path/to/acme-staging-key.pem");
    expect(command).toContain('--pass "$CERT_PASSPHRASE"');
    expect(command).toContain("--cacert /path/to/acme-staging-ca.pem");
    expect(notes.join(" ")).toMatch(/Acme staging/);
  });

  it("uses --cert-type P12 for a .pfx and Windows paths for cmd", () => {
    const bash = requestToCurl(def, {}, "bash", [pfx]).command;
    expect(bash).toContain("--cert /path/to/acme-staging.p12");
    expect(bash).toContain("--cert-type P12");
    expect(bash).not.toContain("--key");
    const cmd = requestToCurl(def, {}, "cmd", [pfx]).command;
    expect(cmd).toContain('"C:\\path\\to\\acme-staging.p12"');
    expect(cmd).toContain('"%CERT_PASSPHRASE%"');
  });

  it("adds nothing without a match, for http, or when the request skips the certificate", () => {
    expect(requestToCurl({ ...def, url: "https://other.test/" }, {}, "bash", [pem]).command).not.toContain("--cert");
    expect(requestToCurl({ ...def, url: "http://api.acme.com/" }, {}, "bash", [pem]).command).not.toContain("--cert");
    const skipped = requestToCurl({ ...def, noCertificate: true }, {}, "bash", [pem]).command;
    expect(skipped).not.toContain("--cert ");
    expect(skipped).toContain("--cacert");
    expect(requestToCurl(def, {}, "bash").command).not.toContain("--cert");
  });
});

describe("script exports with certificates", () => {
  const input: ScriptExportInput = { def, options: DEFAULT_BATCH_OPTIONS, defaults: {}, certificates: [pem] };
  const plain: ScriptExportInput = { ...input, certificates: [] };

  it("writes a settings block for the matching certificate", () => {
    const py = buildScript("python", input);
    expect(py).toContain('CLIENT_CERT = ""');
    expect(py).toContain('CLIENT_KEY = ""');
    expect(py).toContain("REST_RUNNER_CERT_PASSPHRASE");
    expect(py).toContain('CA_CERT = ""');
    const sh = buildScript("bash", input);
    expect(sh).toContain("CLIENT_CERT=''");
    expect(sh).toContain("CLIENT_KEY=''");
    expect(sh).toContain("CA_CERT=''");
  });

  it("leaves scripts without a matching certificate as they were", () => {
    expect(buildScript("python", plain)).not.toContain('CLIENT_CERT = ""');
    expect(buildScript("bash", plain)).not.toContain("CLIENT_CERT=''");
    expect(buildScript("python", { ...input, def: { ...def, noCertificate: true } })).not.toContain('CLIENT_CERT = ""');
  });

  it("matches on the address with environment values filled in", () => {
    const templated = { ...input, def: { ...def, url: "https://{{host}}/v2" }, defaults: { host: "api.acme.com" } };
    expect(buildScript("python", templated)).toContain("CLIENT_CERT");
    expect(buildScript("python", { ...templated, defaults: {} })).not.toContain('CLIENT_CERT = ""');
  });

  it("explains it in the notes", () => {
    const notes = scriptExportNotes(input).join("\n");
    expect(notes).toMatch(/Acme staging/);
    expect(notes).toMatch(/REST_RUNNER_CERT_PASSPHRASE/);
    expect(notes).toMatch(/CA_CERT/);
  });

  it("still parses as Python and Bash", () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-cert-script-"));
    try {
      const py = join(dir, "r.py");
      writeFileSync(py, buildScript("python", input));
      const pyCheck = spawnSync("python3", ["-m", "py_compile", py]);
      if (pyCheck.error === undefined) expect(pyCheck.status).toBe(0);
      const sh = join(dir, "r.sh");
      writeFileSync(sh, buildScript("bash", input));
      const shCheck = spawnSync("bash", ["-n", sh]);
      if (shCheck.error === undefined) expect(shCheck.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
