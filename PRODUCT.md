> DRAFT derived from the repository; needs owner review.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Note: the UI is a React web app shown in a Tauri 2 desktop web view (macOS and Windows, one codebase), not a native iOS/Android or platform-native desktop design language. Mode: Operate (a tool used repeatedly and for long sessions, not a showcase surface). Source: README.md, src-tauri/tauri.conf.json.

## Users
Evidence suggests people who send and check REST API calls by hand and in bulk: they paste cURL or import Postman collections, run one request per CSV row, write test suites with assertions and scripts, and chain them into scheduled flows. Docs also mention handing a workspace to a teammate and exporting batch runs as Python/Bash scripts to run without the app.

> TODO(owner): Who is the primary user (developer, QA/test engineer, support or ops person, integrator)? What situation are they in when they open the app, and how technical are they?

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

> TODO(owner): What does success look like (adoption, time to first request, trust in batch runs, replacing which tool)? The repo has no success metrics.

## Positioning
Evidenced mechanisms: everything is local (no account, server or sync; requests go straight from the machine, sent from the Rust side so browser CORS does not apply); CSV-driven batch runs are a first-class feature; one app covers requests, tests and flows; installers for macOS and Windows.

> TODO(owner): How do you position this against neighbouring tools, and which competitors or anti-references (tools or looks to avoid resembling) are binding? The repo names none.

## Operating Context
- Desktop window used for sustained, repeated work, with several requests open as tabs and batches, suites and flows running side by side.
- Three sections switched from a right-edge side bar: Requests, Testing, Flows (Ctrl/Cmd + 1/2/3). Top bar holds the request switcher, environment switch and quick open (Ctrl/Cmd + K); Request details drawer, Variables and Certificates panels sit alongside.
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

> TODO(owner): Which personality words describe the product and its voice? Is the GitHub-style dark theme a binding commitment or a current default?

## Evidence on Hand
- Brand files in `brand/`, rules in BRAND.md.
- User guide in `docs/` covering every feature; sample workspace at `src/assets/sample-workspace.json`.
- Unit tests under `src/lib`.
- Absent: no user research, testimonials, metrics, pricing, or competitor analysis in the repo. Do not fabricate them.

## Product Principles
Derived from repo behaviour; confirm.
1. Local first: nothing leaves the machine except the requests the user sends.
2. Show exactly what will be and was sent (URL preview, Preview of batch rows, the request actually sent, notes on every call).
3. Guard against costly mistakes: warn on unfilled placeholders, mark production environments, mask secrets, undo instead of confirm on deletes.
4. One set of ideas across the app: placeholders, environments and scripts work the same in Requests, Testing and Flows.
5. Results stay portable: HTML/CSV reports, workspace JSON, standalone scripts.

> TODO(owner): Are these the right principles, and are any missing or wrong?

## Accessibility & Inclusion
Repo shows focus trapping in dialogs, Escape handling, arrow-key radio groups and system/light/dark appearance support. No stated standard.

> TODO(owner): Is there a required accessibility target (for example WCAG 2.1 AA) or known user needs?

## Open questions
1. Who is the primary user, and in what situation do they use the app?
2. What does success look like (metrics, adoption, tools replaced)?
3. How is REST Runner positioned against neighbouring API clients?
4. Which competitors or anti-references are binding (looks or behaviours to avoid)?
5. Which brand personality words and voice describe the product?
6. Is the GitHub-style dark theme a binding commitment or a current default?
7. Is there a required accessibility standard or known user needs?
8. Are the derived product principles correct and complete?
