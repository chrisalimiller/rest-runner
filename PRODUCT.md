# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Note: the UI is a React web app shown in a Tauri 2 desktop web view (macOS and Windows, one codebase), not a native iOS/Android or platform-native desktop design language. Mode: Operate (a tool used repeatedly and for long sessions, not a showcase surface). Source: README.md, src-tauri/tauri.conf.json.

## Users
Evidence suggests people who send and check REST API calls by hand and in bulk: they paste cURL or import Postman collections, run one request per CSV row, write test suites with assertions and scripts, and chain them into scheduled flows. Docs also mention handing a workspace to a teammate and exporting batch runs as Python/Bash scripts to run without the app.

**Owner-confirmed:** mixed users, developer-led. Developers are the primary users; QA and ops people are secondary.

## Product Purpose
A lightweight desktop app for running REST requests, running a request once per CSV row with `{{placeholders}}`, checking responses with test suites, and chaining cases, suites and saved requests into flows (README.md, docs/README.md).

Jobs evidenced in the repo:
- Build and send a single request (params, headers, auth, JSON/text/form body) and inspect the response and the exact request sent.
- Turn a cURL command or Postman collection into a request.
- Organise requests in collections and folders, with named examples and environments (for example Dev and Prod, with secret variables).
- Run a request in bulk from a CSV with concurrency and delay controls, then review results and export HTML/CSV reports or a standalone Python/Bash script.
- Verify behaviour with test suites (no-code assertions plus `rr` JavaScript scripts), including per-CSV-row iterations.
- Chain steps in flows with branches, loops, retries and schedules (scheduled while the app is open).
- Use client certificates / CA for hosts that need them.

**Owner-confirmed success:** it serves as a personal or internal tool, with no adoption target. The measure that matters is trust in batch runs: people rely on bulk runs and their reports without re-checking by hand.

## Positioning
Evidenced mechanisms: everything is local (no account, server or sync; requests go straight from the machine, sent from the Rust side so browser CORS does not apply); CSV-driven batch runs are a first-class feature; one app covers requests, tests and flows; installers for macOS and Windows.

**Owner-confirmed positioning:** lightweight and local. Anti-references, all binding: cloud-first clients (account walls, sync prompts, team upsells, telemetry banners), crowded icon-heavy toolbars in the style of large API platforms, and generic SaaS styling (gradient heroes, pastel cards, marketing polish) inside a work tool.

## Operating Context
- Desktop window used for sustained, repeated work, with several requests open as tabs and batches, suites and flows running side by side.
- Four sections switched from a status bar along the bottom: Requests, Testing, Flows, Tools (Ctrl/Cmd + 1 to 4). Top bar holds the centered quick open (Ctrl/Cmd + K) and the environment switch. Requests has a collapsible collections sidebar on the left (Ctrl/Cmd + B); Variables and Certificates panels dock on the right.
- Keyboard-driven (many shortcuts, see docs/shortcuts.md); system, light and dark appearance options.
- Works offline; fonts are bundled. Data lives in the web view's local storage; builds are unsigned for now; updates are manual (never automatic).
- Runs that may hit real environments: environments can be coloured, and Prod-style environments are marked red on Send and Run buttons.

## Capabilities and Constraints
- Methods GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS; auth: bearer, basic, API key.
- Terminology to preserve: Requests, Testing, Flows, collections, examples, environments, variables, placeholders `{{name}}`, suites, cases, assertions, runs, flows, steps, `rr` scripting object.
- Limits: last 50 sends, last 30 batch runs, last 50 test runs; response bodies cut at 1 MB in saved runs; suite CSV up to 2 MB.
- Secrets are masked on screen, in cURL panel and reports, and left out of workspace export by default.
- Scripts run in a background worker with a time limit (5 s default).
- Platforms: macOS (universal) and Windows (x64) only. No sync, accounts or telemetry.

## Brand Commitments
From BRAND.md: the name is "REST Runner", set in monospace as `rest-runner` with a purple hyphen; the mark is a runner between JSON braces (4:3, `brand/`); brand purple `#bc8cff` (strong `#8957e5`) kept distinct from the PATCH method color; the runner is not colored purple; mark at least 20px tall in UI. The README describes the app as lightweight and offline-capable, with a GitHub-style dark theme. Docs voice is plain, direct and task-oriented.

**Owner-confirmed personality:** fast and no-nonsense. Terse, keyboard-driven, gets out of the way. **Appearance:** the GitHub-style dark theme is the current default, not a binding commitment. Dark and the Mist light theme are both supported, and the System setting decides by default.

## Evidence on Hand
- Brand files in `brand/`, rules in BRAND.md.
- User guide in `docs/` covering every feature; sample workspace at `src/assets/sample-workspace.json`.
- Unit tests under `src/lib`.
- Absent: no user research, testimonials, metrics, pricing, or competitor analysis in the repo. Do not fabricate them.

## Product Principles
Derived from repo behaviour; confirmed correct and complete by the owner.
1. Local first: nothing leaves the machine except the requests the user sends.
2. Show exactly what will be and was sent (URL preview, Preview of batch rows, the request actually sent, notes on every call).
3. Guard against costly mistakes: warn on unfilled placeholders, mark production environments, mask secrets, undo instead of confirm on deletes.
4. One set of ideas across the app: placeholders, environments and scripts work the same in Requests, Testing and Flows.
5. Results stay portable: HTML/CSV reports, workspace JSON, standalone scripts.

## Accessibility & Inclusion
Repo shows focus trapping in dialogs, Escape handling, arrow-key radio groups and system/light/dark appearance support. No stated standard.

**Owner-confirmed:** best effort, with no formal standard. Keep the existing practices (visible focus, keyboard access, contrast checked on both themes, reduced-motion paths).
