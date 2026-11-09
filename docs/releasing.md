# Releasing REST Runner

Releases are published from GitHub Actions. Installed apps read `latest.json` from the newest release when the user clicks **Check for updates** (see "Updating REST Runner" in the README).

## Publish a release

1. Bump the version to the same number in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (and `package-lock.json` / `Cargo.lock` by building once), in a PR. Merge it.
2. On the **Actions** tab, run the **Build** workflow by hand on `main` with `release_tag` set, for example `v0.3.1`. (Tag pushes from cloud sessions are blocked, so use the manual run.)
3. The workflow fails early if the tag does not match the version in `tauri.conf.json`.
4. The release gets the `.dmg`, `.msi`, the setup `.exe`, the macOS `.app.tar.gz` and `latest.json`. Release notes are generated once and used for both the release page and the update dialog. There is no changelog file; for a release with something users must know, paste a hand-written section after the generated notes (a draft for the keychain change is in [release-notes-secrets.md](release-notes-secrets.md)).

Pre-releases and drafts are never offered as updates (GitHub's "latest" skips them).

## What gets offered

- macOS: `REST-Runner.app.tar.gz`, for both Apple silicon and Intel.
- Windows: the setup `.exe` only. The `.msi` is built for anyone who wants it but is not offered as an update.

## The signing key

Update files are signed. Installed apps refuse any download that is not signed with the matching key.

- The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- The private key and its password are the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The secret must be the exact contents of the key file, with no extra characters (a terminal's trailing `%` breaks it).
- Keep a copy of the key file and its password somewhere safe, such as a password manager. If they are lost, installed copies cannot take updates and need one manual reinstall with a new key.

To make a new key: `npm run tauri signer generate -- -w ~/.tauri/rest-runner.key`, update both secrets, and replace `pubkey` in `tauri.conf.json`.
