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
| `rest-runner.environments` | Environments and their variables |
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
| `rest-runner.certificates` | The certificate list: each entry's name, the hosts it applies to, whether it is on, and the details shown for its client certificate and CA |
| `rest-runner.onboarded` | That the welcome screen was dismissed, so it is not shown again |
| `rest-runner.variables-panel` | Whether the Variables sidebar is open, and its filter |
| `rest-runner.curl-open`, `rest-runner.curl-shell` | Whether the curl command is shown under the request, and its shell (Bash or Windows cmd) |
| `rest-runner.script-export-language` | The language last picked in **Export script…** (Python or Bash) |
| `rest-runner.testing-nav-collapsed`, `rest-runner.flows-nav-collapsed` | Whether the list on the left of Testing and of Flows is hidden |

**IndexedDB** (larger items):

| Database | Contents | Limit |
| --- | --- | --- |
| `rest-runner` | Saved batch runs | The last 30 runs; response bodies cut at 1 MB |
| `rest-runner-tests` | Saved test runs, and saved flow runs | The last 50 test runs and the last 50 flow runs; response bodies cut at 1 MB |

The oldest runs are removed automatically past those limits.

Because environments, collections and suites can hold tokens and passwords you typed in, treat the app's data folder and any export file as sensitive. Tokens are stored as plain text. Marking an environment variable as a [secret](requests.md#secret-values) only hides it on screen and in reports and exports; it is still stored as plain text in local storage.

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
- **Script variables:** **Clear** or **Clear all** in the Variables sidebar (top bar, Requests mode).
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
