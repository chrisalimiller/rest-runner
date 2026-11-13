<p align="center"><img src="brand/app-icon.png" alt="" width="88"></p>
<h1 align="center">REST Runner</h1>
<p align="center">Send a request. Send it for every row of a CSV. Test it. Chain it.<br>A lightweight, local desktop app for macOS and Windows.</p>

<p align="center">
  <a href="#get-it">Get it</a> ·
  <a href="docs/README.md">User guide</a> ·
  <a href="docs/getting-started.md">Getting started</a> ·
  <a href="docs/shortcuts.md">Shortcuts</a>
</p>

<p align="center"><img src="docs/images/requests.png" alt="The Requests screen: the request editor with its Params, Auth, Headers, Body and Scripts tabs on the left, the response on the right, and the section bar along the bottom" width="860"></p>

## One app, four jobs

The four sections (Requests, Testing, Flows and Tools) sit in a bar along the bottom of the window. Switch with the tabs or `Ctrl/Cmd + 1` to `4`; anything that is running keeps going while you look at another section.

### Requests
Build a request with params, auth, headers, a body and optional scripts (one row of tabs under the URL), with `{{placeholders}}`, and read the response next to it, including the exact request that was sent. The response is Pretty or Raw, with a Beautify button for Raw. A Save bar appears when a request has unsaved changes. Keep requests in collections and folders, open several as tabs, import a cURL command, or collections and environments from Postman, Insomnia, Bruno or a .env file.

### Batch runs from a CSV
Write the request once with `{{column}}` placeholders, pick a CSV, choose how many run at once and how long to pause, and results stream in as they arrive. Export an HTML or CSV report, or a Python/Bash script to run it without the app.

<p align="center"><img src="docs/images/batch.png" alt="A batch run: five CSV rows sent, all passed, with the selected row's values shown on the right" width="760"></p>

### Test suites
Ordered test cases with no-code assertions (status, time, headers, JSON paths) and optional JavaScript scripts using the `rr` API. A suite can run once per CSV row. See [docs/testing.md](docs/testing.md).

<p align="center"><img src="docs/images/testing.png" alt="The Testing section: a suite with assertions and the results of its last run" width="760"></p>

### Flows
Chain cases, suites and saved requests on a canvas with branches, loops, retries and schedules. See [docs/flows.md](docs/flows.md).

<p align="center"><img src="docs/images/flows.png" alt="A flow on the canvas that ran a suite and then a request, with each step's result" width="760"></p>

### Tools
Turn saved requests into small lookup pages: type an ID, press Look up, and see the answers of several requests side by side. Pick a row from a list, run Action buttons (with a confirm on production-marked environments), save a lookup as an HTML page, and share tools as files. See [docs/tools.md](docs/tools.md).

<p align="center"><img src="docs/images/tools.png" alt="The Tools section: a Subscriber 360 lookup page with several answers side by side" width="760"></p>

## Local by design

- No account, no sync, no telemetry banners. Your data lives on your computer.
- Requests are sent from the Rust side, so browser CORS rules do not apply.
- Secret variables are kept in the macOS Keychain or Windows Credential Manager and masked on screen and in reports.
- Works offline; fonts are bundled.
- Environments can be coloured; Prod-style ones turn Send red, and an environment marked as production asks before a send or batch run (switch this off in Settings, opened from the info button in the top bar).

## Get it

Download the installers from the [latest release](https://github.com/chrisalimiller/rest-runner/releases/latest): a `.dmg` for macOS (Apple Silicon and Intel) and a setup `.exe` or an `.msi` for Windows.

Builds are not signed with a paid certificate yet:

- **macOS:** right-click the app and choose **Open**. If macOS says it is damaged, run `xattr -cr "/Applications/REST Runner.app"` once.
- **Windows:** on the SmartScreen prompt, click **More info**, then **Run anyway**.

### Updating REST Runner

Updating is manual and never automatic. Click the info button in the top bar (Settings), open **About & updates** and press **Check for updates**; **Download and install** installs the newer release and restarts the app, and your saved data stays. Updates work in installed builds only, and versions before v0.3.0 need one manual install first. Details: [Updating](docs/getting-started.md#updating-rest-runner).

## Build from source

```sh
npm install
npm run tauri dev     # run with hot reload
npm test              # unit tests
npm run tauri build   # installer for the current OS
```

Needs Node 22+ and Rust (stable). On Windows also install the WebView2 runtime (already on Windows 11) and the Visual Studio C++ build tools; see the [Tauri prerequisites](https://tauri.app/start/prerequisites/). `npm run dev` runs the UI alone in a browser, which is handy for layout work, but requests there go through the browser, so CORS rules apply. Built with Tauri 2, React and TypeScript. Maintainers: [docs/releasing.md](docs/releasing.md).

### Project layout

```
src/                 React UI
  components/        Editors and panes
  lib/               Request building, templates, sending (no UI code)
src-tauri/           Rust shell, app config, icons, permissions
brand/               Logo and app icon sources (see BRAND.md)
docs/                User guide (start at docs/README.md)
.github/workflows/   Test and build pipeline
```
