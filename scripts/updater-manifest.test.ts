import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { assertTagMatchesVersion, buildManifest, collectSignedFiles, versionFromTag } from "./updater-manifest.mjs";

const files = [
  { name: "REST-Runner_universal.app.tar.gz", signature: "SIG-MAC" },
  { name: "REST-Runner_0.3.0_x64-setup.exe", signature: "SIG-WIN" },
];

describe("updater manifest", () => {
  it("reads the version from a tag", () => {
    expect(versionFromTag("v0.3.0")).toBe("0.3.0");
    expect(versionFromTag("0.3.1")).toBe("0.3.1");
    expect(() => versionFromTag("latest")).toThrow(/not a version tag/);
  });

  it("rejects a tag that differs from the app version", () => {
    expect(() => assertTagMatchesVersion("v0.3.0", "0.3.0")).not.toThrow();
    expect(() => assertTagMatchesVersion("v0.3.1", "0.3.0")).toThrow(/does not match/);
  });

  it("lists macOS (both chips) and the Windows setup.exe, never the msi", () => {
    const m = buildManifest({ tag: "v0.3.0", repo: "me/app", notes: " Notes \n", pubDate: "2026-11-12T00:00:00.000Z", files: [...files, { name: "REST-Runner_0.3.0_x64_en-US.msi", signature: "SIG-MSI" }] });
    expect(m.version).toBe("0.3.0");
    expect(m.notes).toBe("Notes");
    expect(Object.keys(m.platforms).sort()).toEqual(["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
    expect(m.platforms["darwin-aarch64"].url).toBe("https://github.com/me/app/releases/download/v0.3.0/REST-Runner_universal.app.tar.gz");
    expect(m.platforms["darwin-x86_64"].signature).toBe("SIG-MAC");
    expect(m.platforms["windows-x86_64"].url).toBe("https://github.com/me/app/releases/download/v0.3.0/REST-Runner_0.3.0_x64-setup.exe");
    expect(JSON.stringify(m)).not.toContain("MSI");
  });

  it("fails when a platform has no signed file", () => {
    expect(() => buildManifest({ tag: "v0.3.0", repo: "me/app", pubDate: "x", files: [files[0]] })).toThrow(/windows-x86_64/);
  });

  it("collects only update files that have a .sig", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    mkdirSync(join(dir, "macos-universal"));
    writeFileSync(join(dir, "macos-universal", "A.app.tar.gz"), "x");
    writeFileSync(join(dir, "macos-universal", "A.app.tar.gz.sig"), "sigA\n");
    writeFileSync(join(dir, "B-setup.exe"), "x");
    writeFileSync(join(dir, "B-setup.exe.sig"), "sigB");
    writeFileSync(join(dir, "C-setup.exe"), "x"); // unsigned: skipped
    const found = collectSignedFiles(dir).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    expect(found).toEqual([
      { name: "A.app.tar.gz", signature: "sigA" },
      { name: "B-setup.exe", signature: "sigB" },
    ]);
  });
});
