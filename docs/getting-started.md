# Getting started

## Install the app

Every push to `main` builds installers in GitHub Actions. Open the latest run on the repository's **Actions** tab and download:

- `rest-runner-macos-universal`: a `.dmg` that runs on both Apple Silicon and Intel Macs.
- `rest-runner-windows-x64`: an `.msi` and a setup `.exe`.

The builds are not signed with a paid certificate, so the first launch needs one extra step:

- **macOS:** right-click the app and choose **Open**. If macOS says the app is damaged, run `xattr -cr "/Applications/REST Runner.app"` once in Terminal.
- **Windows:** on the SmartScreen prompt, click **More info**, then **Run anyway**.

## First launch

A fresh install opens a welcome screen: import a workspace file a teammate exported, open the sample workspace, or start empty. See [First run](collections.md#first-run).

## Run it from source

You need Node 22 or newer and Rust (stable). On Windows also install the WebView2 runtime (already on Windows 11) and the Visual Studio C++ build tools. See the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev     # run the desktop app with hot reload
npm test              # unit tests
npm run typecheck     # TypeScript check
npm run tauri build   # build an installer for the current OS
```

Notes:

- `npm run dev` and `npm run build` first run `scripts/ensure-deps.mjs`, which runs `npm install` if any package listed in `package.json` is missing from `node_modules`. If you pull changes that add packages, you do not need to remember to install them yourself.
- `npm run dev` on its own starts the UI in a normal browser at `http://localhost:1420`. That is handy for layout work, but requests then go through the browser's `fetch`, so CORS rules apply and the native Save dialog is replaced by a normal file download. Use `npm run tauri dev` to get the real app.
- The JetBrains Mono font is bundled in `src/assets/fonts`, so the app works offline.

## A tour of the window

The app is one window with a bar along the top and a status bar along the bottom (the [status bar](#the-status-bar)).

| Part of the top bar | What it does |
| --- | --- |
| **Brand** | The rest-runner mark. |
| **Request switcher** (Requests mode) | Shows the open request: its collection path, method, name, and a dot when it has unsaved changes. Click the folder area to open your collections. Click the name, or press `F2`, to rename it. |
| **Suite name** (Testing mode), **Flow name** (Flows mode) | The open suite or flow. Click it to switch to another one without opening the list on the left. |
| **Quick open** | A search box that opens with Ctrl/Cmd + K. See [Quick open](shortcuts.md). |
| **Environment switch** | One button per environment plus **None**. When the window is narrow (under 1200 px) or there are more than three environments, it becomes a drop-down that still shows the colour of the selected one. The pencil opens the environment editor (Requests mode only). |

### The status bar

The bar along the bottom holds the four sections, a slot for what is running or has just failed in another section, and two tools. Hover a button for its name, shortcut and status.

| Button | What it does |
| --- | --- |
| **Requests**, **Testing**, **Flows**, **Tools** | Switch section. The open one has a purple icon and a purple line on its top edge. Press `Mod + 1` to `Mod + 4`; with focus in this group the arrow keys move between them. Below 1000 px wide only the open section keeps its name. Testing shows `N✕` after a run with failed cases until you open Testing, and a blue dot while a suite runs. Flows shows a green dot while a flow runs, and `✕` after a failed run until you open Flows. Tools shows an accent dot while a lookup runs, and `✕` when a lookup that finished while you were elsewhere had calls with an error until you open Tools. |
| **Activity** (middle of the bar) | Says "Testing running" (or Flows, Tools, or two of them) while work continues in a section you are not looking at, or "✕ Testing: 3 failed" after a run that failed until you open that section. Click it to go there. Otherwise it says "Nothing running". |
| **{x}** Variables (Requests only) | Opens the [Variables sidebar](requests.md#variables). The badge counts placeholders in the open request that have no value. |
| **Lock** Certificates | Opens the Certificates panel: the certificate this request uses (with **Send without a certificate**), and every imported certificate. A green dot means the open request uses a certificate; amber means one expires within 30 days. **Manage…** opens the full dialog. |

Both panels open the same way: beside the content, never over it, with a ✕ button and Escape to close and the status bar button to toggle. Only one is open at a time, and each is remembered for the next start.

**Requests mode** is split in two. The left column is the request (the URL row with **Send** and a ⋯ menu, a row of tabs for Params, Auth, Headers, Body and Scripts, and the open tab below; Save as example, Run with CSV and cURL are in the ⋯ menu next to Send, and a bar with **Save** appears over the bottom of the column whenever the request has unsaved changes). The right column is the response. Drag the divider to resize the columns (your split is remembered; double-click it to reset; arrow keys move it when it has focus). Below 1000 px wide the columns stack. The top bar always stays on one row: when space runs short it first drops the folder path from the request switcher, then turns Quick open into a search icon with its shortcut hint, then the environment switch into a drop-down. The status bar never moves.

In Testing and Flows the list on the left (suites and runs, flows and runs) can be hidden with the **«** button to give the middle more room; whether it is hidden is remembered. The suite or flow name in the top bar switches between items either way.

**Testing mode** has suites and test runs on the left, the open suite in the middle, and the latest run on the right. See [Testing](testing.md).

**Flows mode** has flows and flow runs on the left, the flow's canvas in the middle, and the selected step's settings (or the latest run) on the right. See [Flows](flows.md).

**Tools mode** has your tools and a tool's recent lookups on the left and the tool's page in the middle, in Use or Build mode. See [Tools](tools.md).

## Your first request

1. In Requests mode, type a URL such as `https://httpbin.org/get`. A URL with no `http://` or `https://` gets `http://` added.
2. Pick a method from the drop-down on the left of the URL bar.
3. Press **Send**, or press Enter in the URL box, or Ctrl/Cmd + Enter anywhere.
4. The response appears on the right: status, time, size, and the body. See [the response viewer](requests.md#the-response-viewer).
5. Press Ctrl/Cmd + S (or **Save**) to keep the request in a [collection](collections.md).

The request you are editing is remembered between launches, even if you never save it.

## Settings

The **info button** in the top bar opens Settings, a dialog with a list on the left:

- **General:** appearance, **Confirm production requests**, **Response size limit (bytes)** (see [Response size limits](requests.md#response-size-limits)) and a note on where secrets are stored.
- **Keyboard shortcuts:** the list from [Quick open and keyboard shortcuts](shortcuts.md).
- **About & updates:** the installed version and **Check for updates**.

## Updating REST Runner

REST Runner never checks for updates by itself. To update an installed copy, click the **info button** in the top bar, which opens Settings (or choose **REST Runner › Check for Updates…** on macOS, or **Settings and about…** in Quick open), go to **About & updates** and press **Check for updates**. If there is a newer release you see its notes; **Download and install** installs it and restarts the app. If a batch, test run or flow is running, it asks before stopping it. Your saved data stays.

Updates only work in installed builds, not in `npm run tauri dev`. Versions before v0.3.0 have no updater: install v0.3.0 by hand once. Maintainers: see [releasing.md](releasing.md).

## Where to go next

- Batch the request over a spreadsheet: [CSV batch runs](batch-runs.md).
- Add checks and run several requests in order: [Testing](testing.md).
- Chain cases, suites and saved requests with branches and retries: [Flows](flows.md).
- Turn saved requests into a lookup page: [Tools](tools.md).
- Pull a token out of one response and use it in the next request: [scripting](scripting.md#quick-example).
