# Requests

Requests mode is where you build a request and read the response. The request is on the left, the response on the right.

## The URL bar

- Pick the **method**: GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS.
- Type the **URL**. If it has no scheme (`http://`, `https://`), `http://` is added when it is sent.
- Hover the URL box to see the **resolved URL**: exactly what Send will use, with environment values, script variables and your enabled query params filled in. Placeholders with no value are shown in red in the summary line, and an amber dot with a count inside the URL box says how many are unfilled (hover for the names). Click the dot to open the [Variables sidebar](#the-variables-sidebar). Send then shows a small ⚠ and reads "Sends with {{token}} as written", but it still sends without asking.
- Press **Enter** in the URL box to send.
- **Copy final URL** in the ⋯ menu copies the resolved URL. The URL shows `{{placeholders}}` in colour while you type, and the same highlighting is used in the Params, Headers and form value fields.
- Open the ⋯ menu next to Send to **Show cURL** (the `curl` command Send would run), or to **Copy as cURL (Bash)** or **Copy as cURL (Windows cmd)** in one click. The command includes with environment values, script variables, auth and the body filled in. Pick **Bash / zsh** (macOS, Linux, Git Bash) or **Windows cmd** in the panel, then **Copy** it into a terminal. Placeholders with no value are listed under the command. Choose **Hide cURL** to close it; whether it is open is remembered.
  - A pre-request script runs only when you press Send, so anything it changes is not in the command.
  - cmd can't pass line breaks inside an argument, so a multi-line JSON body is put on one line there (it means the same thing).

GET and HEAD requests never send a body, even if you filled one in. The summary line reads "No body for GET" and the details fill the space where the body would be.

## The request column

The column has three rows: the URL row (method, URL, **Send** and the ⋯ menu), a summary line, and the body editor, which fills the rest of the height. Params, Auth, Headers and Scripts are in Request details, opened from the summary line under the URL. Save, Save as example, Run with CSV and cURL are in the ⋯ menu next to Send.

- **URL row.** Hover the URL box to see the final URL with environment values and query params filled in. An amber dot with a count inside the box means placeholders have no value; click it to open Variables. The ⋯ menu holds **Save**, **Save as example** (and **Set sample response** when an example has a live response), **Run with CSV…**, **Copy final URL**, **Show cURL** / **Hide cURL** and the two **Copy as cURL** items.
- **Summary line.** The **Request details** button opens or closes the drawer. Next to it, `1 param · Bearer {{token}} · 3 headers · after-script` shows what each part holds; click one to open the drawer on that tab (an auth value with no value is shown in red). The body type, JSON validity and **Format** are at the right end.
- **Request details drawer.** It slides over the body with tabs for Params, Auth, Headers and Scripts. Escape or × closes it and puts focus back on the button that opened it. Whether it is open and which tab are remembered. For GET and HEAD, which send no body, the details are always showing in place of the body.

### Params, Headers and form fields

These are tables of key/value rows.

- Each row has a checkbox. Unticked rows are kept but not sent, so you can switch things on and off.
- A new empty row appears at the bottom as you type. Rows with an empty key are ignored.
- Keys and values can contain `{{placeholders}}`.
- Params are added to the URL as a query string, URL-encoded. If the URL already has a `?query`, the params are appended to it, and any `#fragment` stays at the end.

### Auth

Pick a type from the drop-down:

| Type | What is sent |
| --- | --- |
| **No auth** | Nothing. |
| **Bearer token** | `Authorization: Bearer <token>` |
| **Basic auth** | `Authorization: Basic <base64 of username:password>` |
| **API key** | A header (default name `X-API-Key`) or a query parameter, whichever you choose, with the key name and value you enter. |

If you already added an `Authorization` header yourself, the Auth setting does not replace it. The same goes for an API-key header with the same name. All auth fields accept `{{placeholders}}`, for example a bearer token of `{{token}}`.

### Body

Pick the body type from the drop-down in the section header:

- **None**
- **Raw JSON**: a JSON editor with GitHub-style colors, `{{placeholders}}` highlighted, and errors underlined with the line and column. A "Valid" / "Invalid JSON" indicator is shown. Pasting that leaves valid JSON re-indents the whole body (Ctrl/Cmd + Z undoes it). The **Format** button, or Shift + Alt + F, formats at any time and keeps placeholders exactly as written, even bare ones like `"id": {{id}}`. The header `Content-Type: application/json` is added if you did not set a Content-Type.
- **Raw text**: sent as is, with `Content-Type: text/plain` unless you set one.
- **Form (urlencoded)**: a key/value table, sent as `application/x-www-form-urlencoded`.

How a placeholder is filled in a JSON body:

- **Inside quotes** (`"name": "{{name}}"`) the value is escaped, so quotes, backslashes and line breaks in the value keep the JSON valid.
- **Outside quotes** (`"age": {{age}}`) the value is inserted exactly as is, so numbers, `true`/`false` and `null` work.

### Scripts

The Scripts section holds a **Pre-request** and a **Post-response** script. The section's results (the `rr.test` checks, console output and errors of the last send) appear under the response in a **Scripts** tab, with a badge that is green when every check passed and red otherwise. A bullet (•) on a tab means that script has content. Snippets next to the editor insert common code, and typing `rr.` offers autocomplete. Under the editor, a line says how many script variables earlier sends have set and links to the Variables sidebar, where you can see and clear them. See the [scripting reference](scripting.md) for the full API and when scripts run.

## Placeholders and variables

`{{name}}` (spaces inside the braces are ignored, so `{{ name }}` works) can be used in the URL, param, header and form keys and values, the body, and every auth field. A placeholder with no value anywhere is **left as written** and sent that way. The unfilled dot and, in batch runs, the placeholder check make this easy to spot.

A value for a placeholder can come from three places. Later ones win:

1. The selected **environment**
2. The **CSV row** (batch runs and Testing suites with data)
3. **Script variables**, set by `rr.vars.set()`

For example, if the environment defines `baseUrl`, the CSV has a `baseUrl` column, and a script sets `baseUrl`, the script's value is used. (There is one exception for leftover variables from earlier sends in a batch run. See [Variable scoping](scripting.md#variable-scoping).)

## Variable cards

Rest the pointer on a `{{placeholder}}` for a moment (or press **Ctrl/Cmd + I** with the caret inside one) to see a small card with its current value and where it comes from: **Env · Dev**, **Script** or **Unset**. It works in the URL box, Params and Headers values, form-body values, Auth fields and the raw/JSON body. If a script variable hides an environment value of the same name, the card shows the hidden value struck through.

Edit the value right in the card: Enter or clicking away saves it to whichever place supplies it now (the script variable, or the environment variable), with an **Undo** notice. Esc cancels. For an unset variable the card offers **Add to Dev** (with a Secret switch and an environment picker when you have several). **Show in Variables** opens the sidebar; **Clear script value** forgets a script variable. [Secret](#secret-values) values stay masked until you press **Show**. Testing and Flows do not show these cards.

## The Variables sidebar

Click **Variables** next to the environment switch in the top bar (Requests mode) to open a sidebar on the right. On windows 1240 px wide or more it sits beside the response; on narrower ones it floats over it, and clicking outside closes it. The ✕ button, Escape (with focus inside the panel) and the **Variables** button all close it, and it stays open or closed the next time you start the app.

**This request / All** switches between the variables the open request uses and every variable. **Filter by name** narrows the list. Groups are listed with the winner first, as a send resolves them:

- **Missing**: placeholders the request uses that have no value. **Add to Dev** takes a value (and a Secret switch) and adds the variable to the active environment, creating *Environment 1* if you have none.
- **Script variables**: set by scripts. **Clear** forgets one, **Clear all** forgets them all. A script variable beats the environment value of the same name, which shows struck through as *by Script*.
- **Env · name (active)**: the active environment. If it repeats a name, the last enabled row is the one used and the earlier ones are struck through.
- **Other environments**: folded by default. **Switch to** makes one active.

Click a value to edit it; Enter or clicking away saves it (with an **Undo** notice), Escape cancels. [Secret](#secret-values) values stay masked until you press **Show**. **Edit environments…** opens the full environment editor.

## Environments

An environment is a named set of variables, such as Dev and Prod, each with its own `baseUrl` and `token`.

- Click the **pencil** next to the environment switch in the top bar to open the environment editor. **+ Add environment** creates one. You can rename, **Duplicate** or **Delete** the selected one, and edit its variables in a key/value table (with on/off checkboxes).
- Pick the active environment on the switch. With up to four environments you get one button each plus **None** (arrow keys move between them). With more than four it becomes a drop-down.
- A request that uses `{{baseUrl}}` and `{{token}}` now works against whichever environment is selected.
- Each environment has a **colour** (none, green, blue, amber or red), picked with the swatches at the top of the editor. It shows as a dot on the switch. Environments named Prod, Production or PRD start red. An environment with a colour also marks the buttons that act on it: **Send**, **Run suite** and **Run** (in Flows) get an outline in that colour and say where they will go, for example **Send to Prod**. There is no confirmation dialog; the colour and the label are the guard.
- Only enabled variables with a non-empty name are used.
- Environments are edited in Requests mode. Testing mode has its own environment switch (its choice is remembered separately from Requests), and it picks up edits when you switch over.
- Environment values are stored on this computer only, in the app's local storage. Workspace exports leave [secret values](#secret-values) out unless you ask for them.

### Secret values

Each variable row has a **lock** button. A locked (secret) value shows as dots with an **eye** button to reveal it while you edit (the reveal is not saved). Secret values are:

- hidden as `••••••` in the cURL panel (the **Copy** button still copies the real command), the **Sent request** view, batch call details, and the test and flow reports;
- always masked in the HTML and CSV report exports;
- left out of **Export workspace** unless you choose **Include them** in the export dialog. Leaving them out is the default: the file keeps each secret variable with an empty value, so a teammate who imports it sees which values to fill in, and importing such a file never blanks a secret you already have.

Masking matches the value wherever it appears, including inside JSON, URL-encoded text and the HTML report. It cannot hide a secret that was transformed first, for example inside a Basic auth header (which is base64).

## Sending

- **Send** (or Ctrl/Cmd + Enter, or Enter in the URL box). While sending you see a live elapsed time, and the button becomes **Cancel**.
- Requests are sent from the Rust side of the app, so browser CORS rules do not apply. Allowed URLs are `http://` and `https://` on any host and port.
- If the request has a pre-request script, it runs first. If that script throws, nothing is sent. See [Scripting](scripting.md#when-scripts-run).

## The response viewer

The top of the response column shows the status code and text, time, size and the time the request was sent. Then a switch:

- **Body**: JSON is highlighted. **Raw** shows the body as received and **Pretty** re-indents JSON. **Copy** copies the body.
- **Headers**: all response headers, with a count.
- **Sent request**: the exact request that was sent, after placeholders, auth and default headers were applied.
- **Scripts** (only when the request has scripts): see below. The label shows how many `rr.test` checks passed, for example `Scripts 2/3`, and the tab turns red if something failed.

If no response comes back (server unreachable, DNS error, cancelled) you get an error box with the reason instead of a body. If the pre-request script failed, the box says the request was not sent and links to the script output.

On the **Scripts** tab each script shows how long it took, its error if it threw, each `rr.test` with a pass or fail mark and message, its console output, and the **script variables afterwards**.

## History and earlier sends

Every send is kept in history (the last 50). Each entry holds the request as sent, the status, time, the response (the body is cut at 32 KB), or the error, and what its scripts did.

- Open **Quick open** and look in the **History** group to load one. Loading puts the request back in the editor and shows its response as a sample, labeled for example "Sent 4m ago · 142 ms".
- Under the response, **Earlier sends of this request** shows up to six pills from the history and batch runs of the open request. A pill reads for example `201 · 142 ms · 4m ago` (the time is "12s ago" or "4m ago" within the hour, then `13:41`, "Yesterday", or a short date), with `· Dev` added when that send used a different environment from the one selected now. Hover for the full time, the environment and what changed since the previous send of the request (for example "body changed"). Click a send to see it again, or a batch pill to open that run in the [run explorer](batch-runs.md#the-run-explorer).
- Entries saved by older versions of the app kept only a status. They load with a note that the body and headers were not kept. If local storage is full, responses are dropped from the oldest entries first so the newest stay.
- **Clear history** is in Quick open, in the History group.

Your open tabs, with their edits, are saved as you work and restored at launch.

## Working with tabs

Open requests are tabs in a bar directly under the top bar. With a single unpinned tab the bar is hidden and the screen looks as it always did; it appears when you have two or more tabs, or any pinned tab.

- **Preview and permanent tabs.** A single click on a request in the collections list, a pick in Quick open, a history row or an earlier-send pill opens a **preview** tab, shown in italic. The next single-click open replaces it, so browsing does not pile up tabs. Typing in the request, sending it, pinning it or opening its batch view makes it permanent. To open a permanent tab right away, double-click in the list, press `Mod + Enter` in Quick open, or choose **Open in new tab** in the list's ⋯ menu. If a request is already open in a tab, opening it again just switches to that tab (and keeps your edits).
- **Groups.** Tabs are grouped by the folder that directly holds the saved request, or the collection for a request at its top level. Each group has a small coloured label; two folders with the same name show their collection too ("Trouble Ticket · NaaP E-Bonding"). Requests that are not saved are in a final **Unsaved** group. Saving an unsaved tab moves it into its group. Renaming a saved request renames its tab. Deleting it keeps the tab open as an unsaved request and says so in a message.
- **Pinning.** Right-click a tab and choose **Pin**. Pinned tabs sit at the far left as small tabs showing up to three letters of the name in the method's colour (hover for the full name). They are not closed by **Close others** or **Close saved tabs**, and `Mod + W` on one asks you to unpin it first.
- **Unsaved changes and sending.** An amber dot replaces the × on a tab with unsaved changes (hover or focus the tab to see ×). A spinner replaces the method while a send or a batch is running. Each tab keeps its own response, and you can send in several tabs at once; **Cancel** only stops the send in the tab you are looking at.
- **Batch runs** belong to their tab. Switch tabs and the batch keeps running. A tab with a running batch cannot be closed until you stop it.
- **Closing and undo.** × (or middle-click, or `Mod + W`, or `Delete` on a focused tab) closes a tab without asking. If it had unsaved changes, a message offers **Undo** for 8 seconds. The last 10 closed tabs can be brought back with **Reopen closed tab** (`Mod + Shift + T`), which puts the tab at the end; this list is not kept after you quit. Closing the last tab leaves a new Untitled request.
- **Right-click menu:** Pin or Unpin, Duplicate, Reveal in collections, Close, Close others, Close saved tabs.
- **The ▾ list** at the right end of the bar lists every open tab, grouped like the bar, with its method, an unsaved dot and a **Pinned** tag. Type to filter, use ↑ / ↓ and Enter to go to a tab. At the bottom are **Close saved tabs** and **Reopen closed tab**. When there are more tabs than fit, the bar scrolls sideways (mouse wheel too), and the active tab is kept in view.
- **Keyboard.** Tab into the bar, then use ← / →, Home and End to move between tabs, Enter or Space to open one, and Delete to close it. See [Keyboard shortcuts](shortcuts.md#tabs) for the rest.

The tabs bar is part of the Requests screen only. The Testing case editor and Flows are not affected.
