# Where your data is stored

Everything stays on your computer. REST Runner has no account, no server and no sync. The only network traffic is the requests you send.

## What is saved, and where

The app is a desktop window around a web view, and it keeps its data in that web view's storage for the app (identifier `com.chrisalimiller.restrunner`).

**Local storage** (small items):

| Key | Contents |
| --- | --- |
| `rest-runner.tabs` | The open request tabs: each tab's working copy, which are pinned or preview, and the active tab (`{ v: 1, activeId, tabs }`). Responses and the list of recently closed tabs are not kept |
| `rest-runner.draft` | Old: the single request being edited before tabs existed. It is read once, only when `rest-runner.tabs` is missing, to become the first tab, and is never written again |
| `rest-runner.history` | The last 50 sends, with responses (bodies cut at 32 KB) |
| `rest-runner.collections` | Collections, folders, requests and examples |
| `rest-runner.saved` | The old flat list of saved requests, read once to move them into collections, then left alone as a backup |
| `rest-runner.expanded` | Which collections and folders are expanded |
| `rest-runner.environments` | Environments and their variables. Values of variables marked secret are not kept here: they live in the operating system keychain (blank in this key), and older plain-text values are moved there on launch ([details](#secret-variables-and-the-system-keychain)) |
| `rest-runner.active-environment` | The environment selected in Requests mode |
| `rest-runner.script-vars` | [Script variables](scripting.md#variable-scoping) set by request scripts |
| `rest-runner.batch-options` | Your batch run options |
| `rest-runner.request-details`, `rest-runner.case-request-details`, `rest-runner.split` | Whether the Request details drawer is open and its tab, and the column split |
| `rest-runner.section` | Whether Requests, Testing or Flows was open |
| `rest-runner.test-suites` | Test suites, including their saved CSV data |
| `rest-runner.test-open-suite`, `rest-runner.test-environment` | The open suite, and the environment selected in Testing |
| `rest-runner.flows` | [Flows](flows.md): their steps, wires, sticky notes and settings |
| `rest-runner.flow-open`, `rest-runner.flow-environment` | The open flow, and the environment selected in Flows |
| `rest-runner.flow-schedules` | For each [Schedule](flows.md#schedules) step: the last time it came due, the last run, and the last skipped run with its reason |
| `rest-runner.certificates` | The certificate list: each entry's name, the hosts it applies to, whether it is on, and the details shown for its client certificate and CA. Never the certificate or key files (kept in the app's data folder) or a passphrase (kept in the system keychain); only these fields are written |
| `rest-runner.onboarded` | That the welcome screen was dismissed, so it is not shown again |
| `rest-runner.variables-panel` | Whether the Variables sidebar is open, and its filter |
| `rest-runner.certs-panel` | Whether the Certificates side panel is open |
| `rest-runner.curl-open`, `rest-runner.curl-shell` | Whether the curl command is shown under the request, and its shell (Bash or Windows cmd) |
| `rest-runner.script-export-language` | The language last picked in **Export script…** (Python or Bash) |
| `rest-runner.testing-nav-collapsed`, `rest-runner.flows-nav-collapsed` | Whether the list on the left of Testing and of Flows is hidden |

**IndexedDB** (larger items):

| Database | Contents | Limit |
| --- | --- | --- |
| `rest-runner` | Saved batch runs | The last 30 runs; response bodies cut at 1 MB |
| `rest-runner-tests` | Saved test runs, and saved flow runs | The last 50 test runs and the last 50 flow runs; response bodies cut at 1 MB |

The oldest runs are removed automatically past those limits.

Because environments, collections and suites can hold tokens and passwords you typed in, treat the app's data folder and any export file as sensitive. Tokens you type straight into a request (a header, or the Bearer, Basic or API key fields) are stored as plain text. Values of environment variables marked [secret](requests.md#secret-values) are the exception: they are kept in the system keychain, not in local storage. See the next section.

## Secret variables and the system keychain

**What is in the keychain.** Values of environment variables marked secret (the lock button) are stored in the macOS Keychain or Windows Credential Manager, under the service name `rest-runner`. Each environment's secret values are saved as one JSON text, cut into chunks of at most 1200 bytes. The items are:

- `secrets:env:<environment id>:<n>`, one per chunk;
- `secrets:env:<environment id>`, a small header item holding the number of chunks;
- `secrets:index`, the list of environments that have secrets.

**What stays in local storage.** `rest-runner.environments` keeps the variable's name and its `secret` flag, with an empty value. Nothing else about the secret is kept there.

**One-time migration.** If an earlier version stored secret values as plain text, the app moves them on launch, once the keychain has answered. A value is written to the keychain and checked first; only values confirmed there are blanked in local storage, so nothing is deleted before the keychain write is confirmed. If the keychain already holds a value for a variable, the keychain value wins. If anything blocks the move, the plain values stay where they are, a notice says "Some secret values couldn't be moved to your system keychain. They'll be tried again next launch.", and the move is retried on every launch until it works. After a successful move a notice says how many values were moved (shown once per install), and the app masks copies of those values still sitting in old history, open tabs, script variables and saved runs.

**When the keychain is unavailable or denied.** If the keychain is locked, does not answer within 3 seconds, or access is denied, secret values cannot be loaded or saved. You can still type them, but they exist only in memory for that session; they are never written to local storage as plain text. A banner (under the top bar, and above the Variables list) explains it and, for the first two cases, offers **Retry**:

- "The system keychain isn't available, so secret values can't be loaded or saved. Anything you enter stays in memory for this session."
- "Access to the system keychain was denied. Allow it in your system settings, then retry."
- If a save fails after retries: "Some secret values haven't been saved to the keychain yet. We'll keep trying." (no Retry button; the save is attempted again on later edits and on Retry).

The banner appears only when some variable is marked secret, and can be dismissed for the session. On macOS you may be asked to allow Keychain access on first launch; choose Allow (or Always Allow) so the app can read its own items.

**Running in a browser (development).** Outside the desktop app, for example `npm run dev` in a browser, there is no keychain. Nothing is migrated or blanked there: plain secret values already in local storage stay as they are. Secret values are kept in the tab's `sessionStorage` (key `rest-runner.dev-secrets`), which is cleared when the tab closes, and the banner says "Dev mode: secret values are kept for this browser tab only."

**Exporting and importing.** **Export workspace...** leaves secret values out by default: each secret variable stays in the file with an empty value. If you choose to include them, they are written to the file in plain text, so protect that file. On **Import**, a secret variable that arrives blank keeps the value you already have on this computer; a secret that arrives with a value replaces yours and is saved to the keychain.

**Size limit.** Windows Credential Manager limits one item to 2560 bytes. The app splits an environment's secrets into chunks to stay under that, so many secrets are fine. Extremely large single values may still be refused by the keychain, in which case the save fails with a message that the value is too large for the keychain.

**Going back to an older version.** Versions before this change read secrets from local storage only. After the migration they find an empty value for each secret variable, so you would need to type them again. Export your workspace with secrets included first if you may downgrade.

**Redaction at write time.** Known secret values are masked in the copies of data the app stores, so they do not leak into other local storage:

- **History and saved runs** (batch, test and flow runs): every stored string, such as the resolved URL, response, errors and script output, has known secret values replaced with the mask. History keeps the request as you typed it (with its `{{placeholders}}`) unchanged. Open tabs hold only requests as typed, so they pass through unchanged.
- **Saved example responses** in collections (headers and body) are masked the same way when saved and in workspace exports (unless you include secrets); request definitions are never changed.
- Secret values shorter than 4 characters are not masked, because they would hide ordinary text.
- **Script variables** (`rest-runner.script-vars`): a variable is not saved at all if its name looks like a credential (it contains `token`, `secret`, `password`, `passwd`, `apikey`, `api-key`, `api_key`, `auth` (but not words like "author"), `bearer`, `cookie` or `session`, in any letter case), or if its value contains a known secret. It is set again the next time the script runs.
- **Minimum length:** secret values shorter than 4 characters are not masked, because they would mangle ordinary text.
- **Limits of detection:** only values the app holds as secret variables can be recognised. A value the app never stored as a secret (for example a token a server returned that you did not save as a secret variable), or one that a server or script transformed (base64, hashed, split, re-encoded), cannot be detected and is stored as it appeared.
- **Not protected:** a secret typed literally into a header or auth field is not a secret variable, so it is stored as plain text with the request. Such fields show a **Plain text** badge; replace the value with a `{{placeholder}}` that points to a secret variable.

## Limits

- Local storage is limited in size (typically a few MB). If it is full, history is saved without responses starting with the oldest entries; a suite's CSV data over 2 MB is used for the run but not saved with the suite; and the app shows a notice when suites cannot be saved.
- Reports you export (HTML and CSV) are plain files you can save anywhere. They are not tracked by the app.

## Backing up and moving to another computer

- **Everything at once:** **Export workspace…** in the request switcher's popover writes collections, environments, test suites (with their CSV data) and flows to one file, and **Import** reads it on the other computer. See [Export and import](collections.md#export-and-import).
- **Test suites** and **flows** also export and import on their own, from the Testing and Flows sidebars. See [Testing](testing.md#exporting-suites).
- **Run history** (batch runs, test runs) is not part of those exports. Export the HTML or CSV report of a run if you want to keep it.

## Clearing data

From inside the app:

- **History:** Quick open → History group → **Clear history**.
- **Script variables:** **Clear** or **Clear all** in the Variables sidebar (side bar on the right, Requests mode).
- **Collections, folders, requests, examples:** delete them from the request switcher's tree.
- **Environments:** delete them in the environment editor.
- **Suites:** **Delete suite** in the ⋯ menu of the suite header. Deleting a suite keeps its saved test runs.
- **Test cases, flows and flow steps:** in the ⋯ menu of the case or flow (a step has **Delete step** in its settings).
- **Batch runs, test runs and flow runs:** open one and use **Delete** (in the ⋯ menu for test and flow runs).

Deleting any of these does not ask first. A toast at the bottom left offers **Undo** for 8 seconds. A saved run is only removed from storage when the toast goes away. In Flows, **Ctrl/Cmd + Z** also undoes edits to the canvas (see [Flows](flows.md#undo)).

To wipe everything, quit the app and delete its web view data folder. These are the usual locations. If a folder is not there, search for `com.chrisalimiller.restrunner`.

- **macOS:** `~/Library/WebKit/com.chrisalimiller.restrunner` and `~/Library/Caches/com.chrisalimiller.restrunner`
- **Windows:** `%LOCALAPPDATA%\com.chrisalimiller.restrunner`

Export anything you want to keep first. Deleting the folder cannot be undone, and uninstalling the app may not remove it.

## If the app shows "Something went wrong"

Stored data that cannot be read, for example a value edited by hand, is ignored rather than breaking the app. If REST Runner still hits an error it cannot recover from, it shows **Something went wrong** with the error message instead of a blank window:

- **Reload** starts the app again.
- **Reset view state and reload** first forgets what the screen remembers: the old single draft, which collections and folders are expanded, the Request details drawer and column split, which mode, suite and flow were open, the selected environments, and the hidden lists. Collections, environments, test suites, flows, open tabs, history and saved runs are kept.
