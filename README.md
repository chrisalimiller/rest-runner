# REST Runner

A lightweight desktop app for running REST requests, and (soon) batches of them driven by CSV files. The layout follows Postman: a request editor on top, the response below, and history on the left.

Runs on macOS and Windows from one codebase, built with [Tauri 2](https://tauri.app), React and TypeScript.

## Status

| Step | What | State |
| --- | --- | --- |
| 1 | App shell, single request editor, Mac/Windows builds | Done |
| 2 | CSV batches with `{{column}}` placeholders, live progress | Done |
| 3a | Run explorer, HTML and CSV reports | Done |
| 3b | Saved requests and environments | Planned |
| 4 | Extras: Postman import, retries, OAuth, chaining values between requests | Optional |

## Features so far

- Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Query params, headers and form fields as tables with on/off checkboxes
- Body: raw JSON (with validation and Format), raw text, or x-www-form-urlencoded
- Auth: bearer token, basic auth, or API key (header or query)
- Response viewer: status, time, size, pretty or raw body, headers, and the exact request that was sent
- History of the last 50 requests; your current request is kept between launches
- Send with the button, Enter in the URL box, or Ctrl/Cmd + Enter
- Requests are sent from the Rust side, so browser CORS rules do not apply

## Batch runs from a CSV

1. Write the request with `{{column name}}` placeholders anywhere: URL, params, headers, body, form fields or auth.
2. Open the **Batch run (CSV)** tab under the request and choose a CSV file. The first line must be the column names. Comma, semicolon, tab and pipe separators are detected automatically.
3. Check the placeholder list: green ones are filled from the CSV, red ones have no matching column and are sent as written.
4. Click **Preview** to see the first three requests exactly as they will be sent, then **Run**.

Each row becomes one request. Options:

- **Concurrent requests:** how many run at the same time (1 to 50).
- **Delay between requests:** a pause before each request, useful for rate-limited APIs. Use it with 1 concurrent request for a steady pace.
- **Count 4xx/5xx as failures:** connection errors always count as failures.
- **Stop on first failure:** no new requests start after a failure.

In a raw JSON body, a placeholder inside quotes (`"name": "{{name}}"`) is escaped, so quotes or line breaks in the CSV keep the JSON valid. Outside quotes (`"age": {{age}}`) the value is inserted as is, so numbers, `true`/`false`, and `null` work.

Results appear as they come in. Click a row to see its full request and response, or filter to failures only.

## Run explorer and reports

Every batch run is saved when it finishes (the last 30 runs are kept) and listed under **Batch runs** in the sidebar. Opening one shows:

- Totals: sent, passed, failed, total time, average and 95th percentile response time
- Status code counts; click one to filter the list to that code
- The run log: start, settings, missing placeholders, first failure, why it stopped, and the final count
- Every call, searchable by row, URL, CSV value or note, with its notes, CSV values, full request, response body and response headers. Use the arrow keys to move through calls.

Each call gets plain-language notes when something is worth knowing, such as a placeholder with no value, an HTTP error and whether it counted as a failure, no response, or a JSON response that does not parse.

**Export HTML report** saves one self-contained file with the summary, run log and every call (expandable, with filters and search). It opens in any browser and prints cleanly.

**Export CSV report** saves one line per call with the result, status, timing, full request and response headers and bodies, error, notes, and each CSV value in its own `var:` column. It opens in Excel with UTF-8 intact.

Response bodies over 1 MB are cut to 1 MB when a run is saved, and the call's notes say so.

## Getting the app

Every push builds installers in GitHub Actions. Open the latest run on the **Actions** tab and download:

- `rest-runner-macos-universal` → a `.dmg` that runs on both Apple Silicon and Intel Macs
- `rest-runner-windows-x64` → an `.msi` and a setup `.exe`

The builds are not signed with a paid certificate yet, so the first launch needs one extra step:

- **macOS:** right-click the app and choose **Open**. If macOS says the app is damaged, run `xattr -cr "/Applications/REST Runner.app"` once.
- **Windows:** on the SmartScreen prompt, click **More info**, then **Run anyway**.

## Developing

You need Node 22+ and Rust (stable). On Windows also install the WebView2 runtime (already on Windows 11) and the Visual Studio C++ build tools. See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev     # run the desktop app with hot reload
npm test              # unit tests
npm run tauri build   # build an installer for the current OS
```

`npm run dev` runs the UI alone in a browser. That is handy for layout work, but requests there go through the browser, so CORS rules apply.

## Layout

```
src/                 React UI
  components/        Editors and panes
  lib/               Request building, templates, sending (no UI code)
src-tauri/           Rust shell, app config, icons, permissions
.github/workflows/   Test and build pipeline
```
