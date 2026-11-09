/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BATCH_OPTIONS } from "./batch";
import { buildScript, scriptExportNotes, type ScriptExportInput } from "./scriptExport";
import type { RequestDef } from "./types";

const python = spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0 ? "python3" : null;

const def: RequestDef = {
  id: "r1",
  name: "S",
  method: "GET",
  url: "{{base}}/x",
  params: [],
  headers: [{ id: "h", key: "Authorization", value: "Bearer {{api-token}}", enabled: true }],
  bodyMode: "none",
  body: "",
  formBody: [],
  auth: { type: "none" },
};

const SECRET = "sup3r-s3cret-value";
const input: ScriptExportInput = {
  def,
  options: DEFAULT_BATCH_OPTIONS,
  defaults: { base: "example.test", "api-token": SECRET, other: "x" },
  envName: "Dev",
  secretNames: ["api-token"],
  secretValues: [],
};

describe("secret variables in exported scripts", () => {
  it("never writes the secret value; python reads RR_SECRET_<NAME>", () => {
    const text = buildScript("python", input);
    expect(text).not.toContain(SECRET);
    expect(text).toContain('"api-token": os.environ.get("RR_SECRET_API_TOKEN", "")');
    expect(text).toContain('"base": "example.test"');
    expect(text).toMatch(/# Note: Secret values are not written into the script\. Set RR_SECRET_API_TOKEN/);
  });

  it("never writes the secret value; bash reads RR_SECRET_<NAME>", () => {
    const text = buildScript("bash", input);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("'api-token') REPLY=${RR_SECRET_API_TOKEN:-} ;;");
    expect(text).toContain("'base') REPLY='example.test' ;;");
    expect(text).toMatch(/# Note: Secret values are not written into the script\. Set RR_SECRET_API_TOKEN/);
  });

  it("treats a default holding a known secret value as secret even without a name", () => {
    const text = buildScript("python", { ...input, secretNames: [], secretValues: [SECRET] });
    expect(text).not.toContain(SECRET);
    expect(text).toContain("RR_SECRET_API_TOKEN");
  });

  it("lists the variables in the export notes, and keeps the plain-text warning for the rest", () => {
    const notes = scriptExportNotes(input);
    expect(notes.some((n) => /copied into the script as plain text/.test(n))).toBe(true);
    expect(notes.some((n) => n.includes("RR_SECRET_API_TOKEN") && !n.includes(SECRET))).toBe(true);
    const onlySecret = scriptExportNotes({ ...input, defaults: { "api-token": SECRET } });
    expect(onlySecret.some((n) => /plain text/.test(n))).toBe(false);
  });

  it("keeps non-secret output identical when no variable is secret", () => {
    const plain = { ...input, secretNames: [], defaults: { base: "example.test" } };
    expect(buildScript("python", plain)).toContain('"base": "example.test"');
    expect(buildScript("python", plain)).not.toContain("RR_SECRET");
  });

  it.skipIf(!python)("python script picks the secret up from the environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-secret-"));
    try {
      const file = join(dir, "s.py");
      writeFileSync(file, buildScript("python", input).replace("DRY_RUN = False", "DRY_RUN = True"));
      writeFileSync(join(dir, "d.csv"), "id\n1\n");
      const out = spawnSync(python!, [file, join(dir, "d.csv")], { env: { ...process.env, RR_SECRET_API_TOKEN: "from-env-123" }, encoding: "utf8", cwd: dir }).stdout;
      expect(out).toContain("Bearer from-env-123");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
