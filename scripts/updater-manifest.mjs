#!/usr/bin/env node
// Builds latest.json, the file the app's "Check for updates" reads from the newest GitHub Release.
//
//   node scripts/updater-manifest.mjs check-version v0.3.0
//     Fails unless the tag matches the version in src-tauri/tauri.conf.json.
//
//   node scripts/updater-manifest.mjs build --dir installers --tag v0.3.0 --repo owner/name --notes notes.md --out installers/latest.json
//     Reads the signed update files in --dir (each with a .sig next to it) and writes the manifest.
//
// Used by the release job in .github/workflows/build.yml. Uses only Node built-ins.

import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** "v0.3.0" -> "0.3.0". */
export function versionFromTag(tag) {
  const v = String(tag ?? "").trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v)) throw new Error(`"${tag}" is not a version tag like v0.3.0`);
  return v;
}

/** Throws when the tag and the app's configured version differ: the app would offer the same version again, or miss an update. */
export function assertTagMatchesVersion(tag, configVersion) {
  const v = versionFromTag(tag);
  if (v !== configVersion) {
    throw new Error(`Release tag ${tag} does not match the version ${configVersion} in src-tauri/tauri.conf.json. Bump the version in a PR first, or use tag v${configVersion}.`);
  }
}

/**
 * The platform entries for the files found in a release folder.
 * macOS: the universal .app.tar.gz serves both chips. Windows: the NSIS -setup.exe only (the .msi is not offered).
 * @param {{name: string, signature: string}[]} files update files with their signature text
 */
export function platformEntries(files, urlFor) {
  const platforms = {};
  for (const f of files) {
    if (/\.app\.tar\.gz$/i.test(f.name)) {
      const entry = { signature: f.signature, url: urlFor(f.name) };
      platforms["darwin-aarch64"] = entry;
      platforms["darwin-x86_64"] = entry;
    } else if (/-setup\.exe$/i.test(f.name)) {
      platforms["windows-x86_64"] = { signature: f.signature, url: urlFor(f.name) };
    }
  }
  for (const key of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
    if (!platforms[key]) throw new Error(`No signed update file found for ${key}`);
  }
  return platforms;
}

export function buildManifest({ tag, repo, notes, pubDate, files }) {
  const version = versionFromTag(tag);
  const urlFor = (name) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
  return {
    version,
    notes: (notes ?? "").trim(),
    pub_date: pubDate,
    platforms: platformEntries(files, urlFor),
  };
}

/** Update files in `dir` (searched recursively) that have a .sig next to them. */
export function collectSignedFiles(dir) {
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(app\.tar\.gz|exe)$/i.test(name)) {
        let signature;
        try {
          signature = readFileSync(`${path}.sig`, "utf8").trim();
        } catch {
          continue;
        }
        found.push({ name, signature });
      }
    }
  };
  walk(dir);
  return found;
}

function arg(args, flag, fallback) {
  const i = args.indexOf(flag);
  if (i === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${flag}`);
  }
  return args[i + 1];
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "check-version") {
    const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src-tauri/tauri.conf.json"), "utf8"));
    assertTagMatchesVersion(args[0], config.version);
    console.log(`Tag ${args[0]} matches version ${config.version}.`);
  } else if (command === "build") {
    const notesPath = arg(args, "--notes", "");
    const manifest = buildManifest({
      tag: arg(args, "--tag"),
      repo: arg(args, "--repo"),
      notes: notesPath ? readFileSync(notesPath, "utf8") : "",
      pubDate: new Date().toISOString(),
      files: collectSignedFiles(arg(args, "--dir")),
    });
    writeFileSync(arg(args, "--out"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${arg(args, "--out")} for ${manifest.version}`);
  } else {
    throw new Error("Usage: updater-manifest.mjs check-version <tag> | build --dir <dir> --tag <tag> --repo <owner/name> [--notes <file>] --out <file>");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
