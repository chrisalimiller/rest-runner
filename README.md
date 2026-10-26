# REST Runner

**Documentation:** the [user guide](docs/README.md) covers every feature, including the [`rr` scripting reference](docs/scripting.md) for pre-request and post-response scripts.

A lightweight desktop app for running REST requests, and (soon) batches of them driven by CSV files. The Requests screen puts the request on the left and the response on the right, with one top bar for switching requests, environments and modes.

Runs on macOS and Windows from one codebase, built with [Tauri 2](https://tauri.app), React and TypeScript.

## Status

| Step | What | State |
| --- | --- | --- |
| 1 | App shell, single request editor, Mac/Windows builds | Done |
| 2 | CSV batches with `{{column}}` placeholders, live progress | Done |
| 3a | Run explorer, HTML and CSV reports | Done |
| 3b | Saved requests and environments | Done |
| 4 | Extras: Postman import (done), retries, OAuth, chaining values between requests | Optional |

## Features so far

- Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Query params, headers and form fields as tables with on/off checkboxes
- Body: raw JSON, raw text, or x-www-form-urlencoded
- JSON editor with GitHub-style syntax highlighting, `{{placeholders}}` highlighted, errors underlined with line and column, and **format on paste** (pasting that leaves valid JSON re-indents the whole body; Ctrl/Cmd + Z undoes it). Format button or Shift + Alt + F formats any time, keeping placeholders as written
- GitHub dark theme, with JetBrains Mono for all code (font files live in `src/assets/fonts`, so it works offline and needs no package)
- Auth: bearer token, basic auth, or API key (header or query)
- Response viewer: status, time, size, pretty or raw body, headers, and the exact request that was sent
- Collections with nested folders, opened from the request switcher in the top bar (Save button or Ctrl/Cmd + S), with an unsaved-changes dot. Right-click or use the ⋯ button to add, rename, duplicate, move or delete. Click the request name in the switcher, or press F2, to rename it. Requests saved before collections existed are moved into a "My requests" collection automatically
- Examples: each saved request can keep any number of named sample payloads (Save as example), optionally with the response they got
- Environments: named sets of variables such as `baseUrl` and `token`, picked from the switch in the top bar. The line under the URL shows the final URL with environment values and query params filled in
- Params, Auth, Headers and Body are collapsible sections; closed, each shows a one-line summary. Open sections and the width of the two columns (drag the divider) are remembered
- Quick open (Ctrl/Cmd + K): fuzzy search over requests, examples, history, batch runs, suites, test cases, test runs, flows and flow runs
- Export and import a whole workspace (collections with folders and examples, environments, test suites with their CSV data, and flows) as one JSON file (older export files still import), to back up or hand to a teammate. A fresh install opens a first-run screen: import a shared workspace, open a sample workspace, or start empty
- History of the last 50 requests, in quick open and in the **Earlier sends of this request** strip under the response (click one to see that response again); your current request is kept between launches
- Scripts: each request can have a pre-request and a post-response JavaScript script (`rr` API) for setting variables and checking responses. See [docs/scripting.md](docs/scripting.md)
- Send with the button, Enter in the URL box, or Ctrl/Cmd + Enter
- Requests are sent from the Rust side, so browser CORS rules do not apply

## Environments

The top bar adapts to narrow windows (a search icon, an environment drop-down), the suite and flow names switch between items, and the lists on the left of Testing and Flows can be hidden. In Testing, a case's **Try up to here** runs the cases before it first, a run shows its progress and per-case counts, and the report has a grid of CSV rows by cases. In Flows, a schedule chip in the header shows when the flow runs next and can switch it off, and warnings are counted on the Run button.

Click the pencil next to the environment switch in the top bar to add sets of variables, for example Dev and Prod, each with its own `baseUrl` and `token`. Pick one on the switch, and `{{baseUrl}}` or `{{token}}` anywhere in a request is filled from it. This works for single requests and batch runs. In a batch run, a CSV column with the same name takes priority over the environment.

Each environment can have a colour (a dot on the switch). A coloured environment outlines **Send**, **Run suite** and **Run** and names it in the label, for example **Send to Prod**; environments named Prod start red.

Environment values are stored on this computer only, in the app's local storage. A variable can be marked **secret** (lock button): it is masked on screen, in the cURL panel, and always in exported reports, and Export workspace leaves it out unless you choose to include it. The **Variables** button in the top bar lists the placeholders the open request uses and where each value comes from; an amber "unfilled" chip warns about placeholders with no value before you send.

## Batch runs from a CSV

1. Write the request with `{{column name}}` placeholders anywhere: URL, params, headers, body, form fields or auth.
2. Click **Run with CSV…** under the request (the response column turns into the batch view; switch back with **Response**) and choose a CSV file. The first line must be the column names. Comma, semicolon, tab and pipe separators are detected automatically.
3. Check the placeholder list: green ones are filled from the CSV, blue ones from the selected environment, and red ones have no value and are sent as written.
4. Click **Preview** to see the first three requests exactly as they will be sent, then **Run**.

Each row becomes one request. Options:

- **Concurrent requests:** how many run at the same time (1 to 50).
- **Delay between requests:** a pause before each request, useful for rate-limited APIs. Use it with 1 concurrent request for a steady pace.
- **Count 4xx/5xx as failures:** connection errors always count as failures.
- **Stop on first failure:** no new requests start after a failure.

**Export script…** shows the batch as a Python or Bash script to copy, or saves it to a file, so you can run it in a terminal on macOS or Windows, without the app. See [Exporting a batch as a script](docs/batch-runs.md#exporting-a-batch-as-a-script).

In a raw JSON body, a placeholder inside quotes (`"name": "{{name}}"`) is escaped, so quotes or line breaks in the CSV keep the JSON valid. Outside quotes (`"age": {{age}}`) the value is inserted as is, so numbers, `true`/`false`, and `null` work.

Results appear as they come in. Click a row to see its full request and response, or filter to failures only.

## Run explorer and reports

Every batch run is saved when it finishes (the last 30 runs are kept) and can be opened from quick open or from the **Earlier sends** strip of its request. Opening one shows:

- Totals: sent, passed, failed, total time, average and 95th percentile response time
- Status code counts; click one to filter the list to that code
- The run log: start, settings, missing placeholders, first failure, why it stopped, and the final count
- Every call, searchable by row, URL, CSV value or note, with its notes, CSV values, full request, response body and response headers. Use the arrow keys to move through calls.

Each call gets plain-language notes when something is worth knowing, such as a placeholder with no value, an HTTP error and whether it counted as a failure, no response, or a JSON response that does not parse.

**Export HTML report** saves one self-contained file with the summary, run log and every call (expandable, with filters and search). It opens in any browser and prints cleanly.

**Export CSV report** saves one line per call with the result, status, timing, full request and response headers and bodies, error, notes, and each CSV value in its own `var:` column. It opens in Excel with UTF-8 intact.

Response bodies over 1 MB are cut to 1 MB when a run is saved, and the call's notes say so.

## Testing

Switch to **Testing** at the top right. Suites and test runs are listed on the left, the open suite reads as a runbook in the middle (one step per case, with a pass/fail disc), and the latest run is summarized on the right. A **test suite** is an ordered list of **test cases**; a case is a request plus checks.

- **Add cases** from your saved requests (each case gets its own copy, and **Update from saved request** pulls in later changes) or start a blank one. Reorder with the arrows, untick a case to skip it, or duplicate it.
- **Assertions** are a no-code table: status code (exact, or a class like `2xx`), response time, response size, a header, the body text, or a JSON path such as `$.data[0].id` or `$.items.length`. Conditions include equals, contains, less/greater than, exists, matches regex and is of type. Expected values can use `{{variables}}`.
- **Scripts** are JavaScript run before the request (**Pre-request**) or after the response (**Post-response**). They get an `rr` object:
  - `rr.test("name", () => rr.expect(value).toBe(...))` adds a check. `expect` also has `toEqual`, `toContain`, `toBeLessThan`, `toBeGreaterThan`, `toBeDefined`, `toMatch`, `toHaveProperty`, `toHaveLength`, and `.not`.
  - `rr.vars.set("token", rr.response.json().token)` passes a value to later cases, which use it as `{{token}}`. `rr.vars.get(name)` reads run variables, then the CSV row, then the environment.
  - `rr.response` has `status`, `time`, `size`, `body`, `json()`, `header(name)`; `rr.data` is the CSV row; `console.log` output is kept with the result.
  - Scripts run in a background worker and are stopped after the suite's time limit (5 s by default), so a bad loop cannot freeze the app. Snippets next to the editor insert common checks.
- **Try case** sends one case on its own and shows its checks, without running the whole suite. The assertions table's **Last result** column shows each check's outcome and the value seen, from the last Try case or else the latest run.
- **Passes on:** when a post-response script calls `rr.vars.set("name", …)`, the case shows which variables it hands to later cases, with the last value set.
- **Edit request** opens the case's request in the same editor as the Requests screen.

**Run settings & data** sets how the suite runs:

- **Sequential:** one case at a time, in order. Variables set by a case carry to the next case in the same iteration.
- **Iterations in parallel:** several CSV rows (or repeats) at once, each running its cases in order.
- **Cases in parallel:** all cases of an iteration start together (they cannot pass variables to each other).
- Concurrency, a delay between cases, **Repeat** (go through the data N times), stop on first failed case, and whether a 4xx/5xx fails a case that has no status assertion of its own.
- **CSV data:** the whole suite runs once per row, with `{{column}}` filled from that row. The file is saved with the suite (up to 2 MB). Each iteration starts with fresh run variables.

A case passes when every check passes: its enabled assertions, every `rr.test`, both scripts finishing without an error, and a response arriving.

Finished runs are saved (the last 50) under **Test runs**. The report shows cases and checks passed, timing, a per-case table (click a case to filter), the run log, and every result with its checks, notes, variables, request, response and script output. **Export HTML report** and **Export CSV report** work like the batch reports, with one line or section per case per iteration. Suites can be exported and imported as a JSON file from the Suites list.

## Flows

Switch to **Flows** at the top right to chain test cases, suites and saved requests into one run on a canvas. Wire steps by their **passed** and **failed** outputs, branch with **If**, run branches side by side with **Parallel** and **Join**, repeat steps per CSV row with **Loop over CSV**, and add **Wait**, **Set variable**, retries and sticky notes. A **Schedule** step runs the flow every N minutes, daily, or on chosen weekdays while the app is open.

A Run request step fails on a 4xx/5xx unless you turn off its **4xx/5xx counts as failed** checkbox. A flow that only got to its end because a failed step had a failed wire ends **Passed with handled failures** (amber). Deleting things never asks: an **Undo** toast appears, and Ctrl/Cmd + Z undoes canvas edits. A readable opening view and **Tidy layout** keep big flows usable.

Each run is saved with a combined report: every step, and each Run step's full test report, exportable as one HTML or CSV file. Flows can be exported and imported together with the suites and saved requests they use. See [docs/flows.md](docs/flows.md).

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
brand/               Logo and app icon sources (see BRAND.md)
docs/                User guide (start at docs/README.md)
.github/workflows/   Test and build pipeline
```
