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

The app is one window with a single bar along the top.

| Part of the top bar | What it does |
| --- | --- |
| **Brand** | The rest-runner mark. |
| **Request switcher** (Requests mode) | Shows the open request: its collection path, method, name, and a dot when it has unsaved changes. Click the folder area to open your collections. Click the name, or press `F2`, to rename it. |
| **Suite name** (Testing mode), **Flow name** (Flows mode) | The open suite or flow. Click it to switch to another one without opening the list on the left. |
| **Quick open** | A search box that opens with Ctrl/Cmd + K. See [Quick open](shortcuts.md). |
| **Environment switch** | One button per environment plus **None**. When the window is narrow (under 1200 px) or there are more than three environments, it becomes a drop-down that still shows the colour of the selected one. The pencil opens the environment editor (Requests mode only). |
| **Section switcher** (far right) | One segmented control for Requests, Testing and Flows. The open section shows its name; the other two show just an icon (hover for its name and shortcut). Press `Mod + 1`, `Mod + 2` or `Mod + 3` to switch. With focus on it, the arrow keys move between sections and Enter picks one. |

**Requests mode** is split in two. The left column is the request (URL bar, resolved URL, collapsible Params / Auth / Headers / Body / Scripts sections, and an action footer with **Send**, **Save**, **Run with CSV…**). The right column is the response. Drag the divider to resize the columns (your split is remembered; double-click it to reset; arrow keys move it when it has focus). Below 1000 px wide the columns stack. Under 1366 px the top bar shrinks too: Quick open becomes a search icon with its shortcut hint.

In Testing and Flows the list on the left (suites and runs, flows and runs) can be hidden with the **«** button to give the middle more room; whether it is hidden is remembered. The suite or flow name in the top bar switches between items either way.

**Testing mode** has suites and test runs on the left, the open suite in the middle, and the latest run on the right. See [Testing](testing.md).

**Flows mode** has flows and flow runs on the left, the flow's canvas in the middle, and the selected step's settings (or the latest run) on the right. See [Flows](flows.md).

## Your first request

1. In Requests mode, type a URL such as `https://httpbin.org/get`. A URL with no `http://` or `https://` gets `http://` added.
2. Pick a method from the drop-down on the left of the URL bar.
3. Press **Send**, or press Enter in the URL box, or Ctrl/Cmd + Enter anywhere.
4. The response appears on the right: status, time, size, and the body. See [the response viewer](requests.md#the-response-viewer).
5. Press Ctrl/Cmd + S (or **Save**) to keep the request in a [collection](collections.md).

The request you are editing is remembered between launches, even if you never save it.

## Where to go next

- Batch the request over a spreadsheet: [CSV batch runs](batch-runs.md).
- Add checks and run several requests in order: [Testing](testing.md).
- Chain cases, suites and saved requests with branches and retries: [Flows](flows.md).
- Pull a token out of one response and use it in the next request: [scripting](scripting.md#quick-example).
