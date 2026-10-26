# Requests

Requests mode is where you build a request and read the response. The request is on the left, the response on the right.

## The URL bar

- Pick the **method**: GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS.
- Type the **URL**. If it has no scheme (`http://`, `https://`), `http://` is added when it is sent.
- Under the bar, the **resolved URL** line shows exactly what Send will use, with environment values, script variables and your enabled query params filled in. Placeholders that still have no value are shown in red, and an amber chip at the end of the line says how many are unfilled ("1 unfilled: token", or "3 unfilled"; hover for the names). Click the chip to open the [Variables popover](#the-variables-popover). Send then shows a small ⚠ and reads "Sends with {{token}} as written", but it still sends without asking. The line also says which environment the values came from.
- Press **Enter** in the URL box to send.
- Click the copy button at the end of the resolved URL line to copy the full URL. The URL shows `{{placeholders}}` in colour while you type, and the same highlighting is used in the Params, Headers and form value fields.
- Open the **cURL ▾** menu at the end of the resolved URL line to **Show cURL** (the `curl` command Send would run), or to **Copy as cURL (Bash)** or **Copy as cURL (Windows cmd)** in one click. The command includes with environment values, script variables, auth and the body filled in. Pick **Bash / zsh** (macOS, Linux, Git Bash) or **Windows cmd** in the panel, then **Copy** it into a terminal. Placeholders with no value are listed under the command. Choose **Hide cURL** to close it; whether it is open is remembered.
  - A pre-request script runs only when you press Send, so anything it changes is not in the command.
  - cmd can't pass line breaks inside an argument, so a multi-line JSON body is put on one line there (it means the same thing).

GET and HEAD requests never send a body, even if you filled one in. The Body section warns you ("not sent with GET").

## The sections

A **section bar** under the URL line has one chip per section (**Params**, **Auth**, **Headers**, **Body**, **Scripts**) with a count or a one-word summary, such as `Params 2` or `Auth Bearer`. Click a chip to scroll to that section and open it; the chip of the section you are in is highlighted.

Below it are five collapsible sections: **Params**, **Auth**, **Headers**, **Body** and **Scripts**. When a section is closed it shows a one-line summary, so you can check it without opening it. Which sections are open, and the width of the two columns, are remembered. By default Body is open for methods that carry a body and Params is open for GET and HEAD.

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

The Scripts section holds a **Pre-request** and a **Post-response** script. The section's results (the `rr.test` checks, console output and errors of the last send) appear under the response in a **Scripts** tab, with a badge that is green when every check passed and red otherwise. A bullet (•) on a tab means that script has content. Snippets next to the editor insert common code, and typing `rr.` offers autocomplete. Under the editor, a line says how many script variables earlier sends have set and links to the Variables popover, where you can see and clear them. See the [scripting reference](scripting.md) for the full API and when scripts run.

## Placeholders and variables

`{{name}}` (spaces inside the braces are ignored, so `{{ name }}` works) can be used in the URL, param, header and form keys and values, the body, and every auth field. A placeholder with no value anywhere is **left as written** and sent that way. The resolved URL line and, in batch runs, the placeholder check make this easy to spot.

A value for a placeholder can come from three places. Later ones win:

1. The selected **environment**
2. The **CSV row** (batch runs and Testing suites with data)
3. **Script variables**, set by `rr.vars.set()`

For example, if the environment defines `baseUrl`, the CSV has a `baseUrl` column, and a script sets `baseUrl`, the script's value is used. (There is one exception for leftover variables from earlier sends in a batch run. See [Variable scoping](scripting.md#variable-scoping).)

## The Variables popover

Click **Variables** next to the environment switch in the top bar (Requests mode). It lists every `{{placeholder}}` the open request uses, with its value (masked when it is a [secret](#secret-values)) and where the value comes from: **Env · SIT**, **Script**, or **Unset**. **Edit** opens the environment editor on that variable (for an unset one it adds the variable to the active environment first). **Clear** forgets a script variable. A second section lists all script variables, with **Clear all**. Escape closes it.

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

Your current request (the draft) is saved as you edit and restored at launch.
