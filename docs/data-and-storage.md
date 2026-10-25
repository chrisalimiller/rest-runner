# Where your data is stored

Everything stays on your computer. REST Runner has no account, no server and no sync. The only network traffic is the requests you send.

## What is saved, and where

The app is a desktop window around a web view, and it keeps its data in that web view's storage for the app (identifier `com.chrisalimiller.restrunner`).

**Local storage** (small items):

| Key | Contents |
| --- | --- |
| `rest-runner.draft` | The request you are editing |
| `rest-runner.history` | The last 50 sends, with responses (bodies cut at 32 KB) |
| `rest-runner.collections` | Collections, folders, requests and examples |
| `rest-runner.saved` | The old flat list of saved requests, read once to move them into collections, then left alone as a backup |
| `rest-runner.expanded` | Which collections and folders are expanded |
| `rest-runner.environments` | Environments and their variables |
| `rest-runner.active-environment` | The environment selected in Requests mode |
| `rest-runner.script-vars` | [Script variables](scripting.md#variable-scoping) set by request scripts |
| `rest-runner.batch-options` | Your batch run options |
| `rest-runner.request-sections`, `rest-runner.case-request-sections`, `rest-runner.split` | Which sections are open and the column split |
| `rest-runner.section` | Whether Requests or Testing was open |
| `rest-runner.test-suites` | Test suites, including their saved CSV data |
| `rest-runner.test-open-suite`, `rest-runner.test-environment` | The open suite, and the environment selected in Testing |
| `rest-runner.flows` | [Flows](flows.md): their steps, wires and settings |

**IndexedDB** (larger items):

| Database | Contents | Limit |
| --- | --- | --- |
| `rest-runner` | Saved batch runs | The last 30 runs; response bodies cut at 1 MB |
| `rest-runner-tests` | Saved test runs, and saved flow runs | The last 50 test runs and the last 50 flow runs; response bodies cut at 1 MB |

The oldest runs are removed automatically past those limits.

Because environments, collections and suites can hold tokens and passwords you typed in, treat the app's data folder and any export file as sensitive. Tokens are stored as plain text.

## Limits

- Local storage is limited in size (typically a few MB). If it is full, history is saved without responses starting with the oldest entries; a suite's CSV data over 2 MB is used for the run but not saved with the suite; and the app shows a notice when suites cannot be saved.
- Reports you export (HTML and CSV) are plain files you can save anywhere. They are not tracked by the app.

## Backing up and moving to another computer

- **Collections and environments:** Export from the request switcher's popover, Import on the other computer. See [Export and import](collections.md#export-and-import).
- **Test suites** (with their CSV data): **Export** and **Import** in the Testing sidebar. See [Testing](testing.md#exporting-suites).
- **Run history** (batch runs, test runs) is not part of those exports. Export the HTML or CSV report of a run if you want to keep it.

## Clearing data

From inside the app:

- **History:** Quick open → History group → **Clear history**.
- **Script variables:** the **Clear** button under a request's script editor.
- **Collections, folders, requests, examples:** delete them from the request switcher's tree.
- **Environments:** delete them in the environment editor.
- **Suites:** **Delete** at the bottom of a suite. Deleting a suite keeps its saved test runs.
- **Batch runs and test runs:** open one and press **Delete**.

To wipe everything, quit the app and delete its web view data folder. These are the usual locations. If a folder is not there, search for `com.chrisalimiller.restrunner`.

- **macOS:** `~/Library/WebKit/com.chrisalimiller.restrunner` and `~/Library/Caches/com.chrisalimiller.restrunner`
- **Windows:** `%LOCALAPPDATA%\com.chrisalimiller.restrunner`

Export anything you want to keep first. Deleting the folder cannot be undone, and uninstalling the app may not remove it.
