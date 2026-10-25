# REST Runner user guide

REST Runner is a desktop app (macOS and Windows) for sending REST requests, running a request once per row of a CSV file, and checking responses with test suites. This guide covers every feature as it works today.

| Page | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Installing the app, running it from source, a tour of the window, your first request |
| [Requests](requests.md) | The request editor: URL, params, auth, headers, body, `{{placeholders}}`, environments, the response viewer, history |
| [Collections, examples and import/export](collections.md) | Saving requests in folders, saved examples, moving data between computers |
| [CSV batch runs and reports](batch-runs.md) | Run a request once per CSV row, export it as a Python or Bash script, the run explorer, HTML and CSV reports |
| [Testing](testing.md) | Test suites, cases, assertions, run modes, CSV data, test reports |
| [Scripting reference (`rr`)](scripting.md) | Every method and property available in pre-request and post-response scripts, with examples, timeouts and variable scoping |
| [Quick open and keyboard shortcuts](shortcuts.md) | Ctrl/Cmd + K search and every shortcut |
| [Where your data is stored](data-and-storage.md) | What is saved on your computer, limits, backups, and how to clear it |

## Ideas that run through the whole app

- **Placeholders.** Write `{{name}}` almost anywhere in a request. When the request is sent, `{{name}}` is replaced by a value from the selected environment, the current CSV row, or a variable set by a script. See [Requests](requests.md#placeholders-and-variables).
- **Two modes.** **Requests** is for building and sending requests one at a time or in CSV batches. **Testing** is for suites of cases with checks. Switch with the tabs at the top right. Both stay alive while you switch, so a running batch or suite carries on.
- **Scripts.** A request (and each test case) can have a **pre-request** script and a **post-response** script, written in JavaScript against an `rr` object. See the [scripting reference](scripting.md).
- **Everything is local.** Requests go straight from your computer to the API. Nothing is sent anywhere else, and nothing is synced. See [Where your data is stored](data-and-storage.md).
