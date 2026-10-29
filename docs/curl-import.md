# Paste a cURL command

Paste a `curl` command and REST Runner makes a request from it. It works with the commands you get from **Copy as cURL** in Chrome or Edge DevTools (Bash and Windows cmd versions), from API docs, and from the **Copy as cURL** items in this app's own ⋯ menu. Nothing is sent when you import: you review the request and press **Send** yourself.

## Ways to start

| From | What happens |
| --- | --- |
| **Paste into the URL box** | The command fills the open tab if it is blank and not saved. Otherwise it opens in a **new tab** after the current one, and your current tab is left alone. A banner under the URL row says what was done. |
| **Paste anywhere in Requests** | With focus outside a text box (say, after clicking the response), `Mod + V` with a curl command on the clipboard does the same as pasting into the URL box. Pasting something that is not curl does nothing. Pasting into the body editor, a script editor or any other text box pastes text as usual. |
| **Collections popover** | **From cURL…**, beside **+ New request**. If the open request is saved, **Save to** is ticked and set to its folder. |
| **Right-click the tab bar +** | **New from cURL…** (a plain click still opens a blank tab). The bar shows with two or more tabs. |
| **⋯ menu next to Send** | **Replace from cURL…** fills the open request. It keeps the request's name, scripts and certificate setting and replaces the method, URL, params, headers, body and auth. |
| **Quick open** (`Mod + K`) | Type `curl`, `paste` or `import` and pick **Import from cURL…**. Pasting a whole curl command into the Quick open box opens the dialog with it filled in. |

There is no keyboard shortcut of its own: `Mod + Shift + T` already means "reopen closed tab".

## The banner

After a paste into the URL box or anywhere, the banner shows:

- a one-line summary (for example `POST api.example.com/orders · 3 headers · JSON body · Bearer token`);
- which `{{variables}}` were used, with **Keep literal values** to switch them back (then **Use variables** switches again);
- a **!** line for each thing that was left out or changed, and a **·** line for small notes;
- **Undo**, which puts back what the tab held before, or closes the tab if the import made it (it does not go into "Reopen closed tab"). If the import also saved the request, Undo removes the saved copy too.

Editing the request hides the banner. It is not kept when you quit the app.

## The dialog

The dialog has the command on the left and a live preview of the request on the right (name, method and URL, params, auth, headers, body, notes).

- **Read as** is **Auto** by default (a line ending in `\` or any single quote means Bash; a line ending in `^` or `^"` means Windows cmd). Pick **Bash** or **cmd** to override.
- **Open in:** **New tab** or **This tab** (replace the open request, like the ⋯ menu item).
- **Save to** also saves the request in a collection or folder (or a new collection). It is only available with **New tab**. Without it the request stays unsaved, like a new blank request.
- If the command can't be read, the preview is replaced by the reason, for example "A quote opened on line 2, column 6 is never closed." Text that does not start with `curl` says so and suggests **Copy as cURL** in DevTools instead of "Copy as fetch". The text stays editable.
- Opening the dialog never reads the clipboard by itself: paste into it.

### Several commands at once

If the text holds more than one command, the dialog shows a list: one row per command with a checkbox, method, URL, an editable name and a note count. Commands start where a line begins with `curl`; lines between them (such as `export TOKEN=…` or `# comments`) are skipped and listed under the table.

Choose **In N new tabs** or **In a collection**. A collection import goes into a folder named `Pasted <day> <month>` (change or clear the name), and the first request opens in a tab. A message offers **Undo**, which removes what was saved and closes the tabs it opened.

## What is read

| In the command | In the request |
| --- | --- |
| `-X` / `--request` | Method (upper-cased; only the methods the app supports). Without it: POST when there is data, HEAD for `-I`, else GET |
| URL (first bare word, or `--url`) | URL, with the query string split into **Params** (decoded). A `#fragment` is dropped. A second URL is ignored with a note |
| `-H` / `--header` | Headers. `Name;` is an empty value. `Name:` (remove header) is left out |
| `Authorization: Bearer …` | **Auth** Bearer (the header is removed) |
| `Authorization: Basic …` | **Auth** Basic when the value decodes to `user:password`; otherwise it stays a header |
| `-u` / `--user` | **Auth** Basic |
| `-d`, `--data`, `--data-raw`, `--data-binary`, `--data-ascii` | Body. Several are joined with `&`. `-d` drops line breaks like curl does |
| `--json` | JSON body, with `Content-Type` and `Accept` set |
| `--data-urlencode`, `-F` / `--form` text fields | A **form (urlencoded)** body |
| `-G` / `--get` | Data values move into **Params** and the body stays empty |
| `-b` / `--cookie` | A `Cookie` header |
| `-A`, `-e` | `User-Agent` and `Referer` headers |

Body type: a body that parses as a JSON object or array, or any body sent with a JSON `Content-Type`, becomes **Raw JSON** (formatted like the editor does on paste). A form body (`a=1&b=2` with a form content type, or no content type) becomes **form fields**. Anything else is **text**. The `Content-Type` header is kept unless it is exactly the one the app adds itself for that body type. A `-d` body that is neither JSON nor form keeps text mode and gets `Content-Type: application/x-www-form-urlencoded`, which is what curl sends.

### Quoting

Bash: `'…'`, `"…"` (with `\"`, `\\`, `\$`), `$'…'` (`\n`, `\t`, `\xHH`, `\uHHHH`), backslash-newline joins lines, bundled flags (`-sSLX POST`), attached values (`-XPOST`, `-HAccept:x`) and `--flag=value`. `$VARIABLE` stays as written; nothing is expanded.

Windows cmd: `^` escapes, a `^` at the end of a line joins lines, and `"…"` with `\"` or `""`. Chrome's `^"`, `^&` and `^%` all decode. A leading `$ ` or `> ` prompt and `curl.exe` are accepted.

## What is left out

Left out with a **!** note in the banner and preview:

| In the command | Why |
| --- | --- |
| `-k` / `--insecure` | REST Runner always checks certificates. Add the server's CA under **Certificates** |
| `--cert`, `--key`, `--cacert`, `--capath`, `--pass`, `--cert-type` | Certificates are set up under **Certificates**. If one already matches the URL, a note says so |
| `-d @file`, `--data-binary @file`, `--json @file`, `-F name=@file`, `--data-urlencode name@file` | File bodies and uploads are not supported. The request is made without them |
| `-F` (multipart) | Becomes an urlencoded form, with a note: servers that need multipart will not accept it |
| `-x` / `--proxy`, `--resolve`, `--connect-to`, `-o`, `-O`, `-T`, `--digest`, `--ntlm`, `--negotiate` | Not supported. The request is made without them |
| `-b file` | Cookie jar files are not read |
| A body on GET or HEAD | Kept in the editor, with a note that it will not be sent |
| An unknown option | Ignored, with a note |

Ignored without a note, because they change nothing the request sends: `--compressed`, `-s`, `-S`, `-v`, `-L`, `-i`, `--http1.1`, `--http2`, `-m` / `--max-time`, `--retry*`, `-w`, `-f` and similar.

Not supported at all: PowerShell (`Invoke-WebRequest`, "Copy as PowerShell") and `fetch()` snippets. Pasting `-d @-` (data from standard input) leaves the body empty with the file-body note.

## Variables

When an environment is selected, literal values in the command are swapped for its `{{variables}}`, so a token or host does not end up typed into a saved request.

- Only enabled variables with a value of **4 characters or more** are used. The longest value wins, so `https://sit.example.net/api` is chosen over `https://sit.example.net`.
- The **URL** is matched by its start, at a boundary (`/`, `?`, `:` or the end), so `https://sit.example.net2/x` does not match `https://sit.example.net`. A trailing `/` on either side is tolerated.
- **Whole values** are matched exactly (case-sensitive) in param values, header values, form values, the Bearer token and the Basic user name and password. `Bearer <value>` is matched on the token part.
- **Bodies are never changed.** Use the [Variables sidebar](requests.md#the-variables-sidebar) afterwards if you want a placeholder inside JSON.
- **Secret** variables are swapped too, which is the point: the token is not saved in the request. The dialog hides secret values.
- The dialog has a checkbox to turn this off, and the banner has **Keep literal values**. With no environment selected, or no match, nothing is swapped and the option is not shown.
