# CSV batch runs and reports

A batch run sends the open request once per row of a CSV file, filling `{{column}}` placeholders from that row.

## Running a batch

1. Write the request with `{{column name}}` placeholders anywhere: URL, params, headers, body, form fields or auth.
2. Click **Run with CSV…** under the request. The response column turns into the **Batch run** view. A **Response / Batch run** switch lets you go back.
3. Click **Choose CSV…** (file types `.csv`, `.tsv` and `.txt`).
4. Check the placeholder list, then **Preview**, then **Run**.

### The CSV file

- The first line must be the column names.
- Comma, semicolon, tab and pipe separators are detected automatically from the first line.
- Quoted fields, `""` escapes, line breaks inside quotes, and a leading byte-order mark are handled. Blank lines are skipped.
- Blank header names become `column1`, `column2`, and so on. A repeated header gets a suffix (`name_2`) and a warning.
- Rows with more or fewer values than the header produce a warning. Missing values are empty and extra values are ignored.

### The placeholder check

Once a file is loaded you see where each placeholder in the request will get its value:

- Green, **Filled from CSV**: a column has that name.
- Blue, **From &lt;environment&gt;**: the selected environment defines it.
- Blue, **From scripts**: a pre-request script sets it with `rr.vars.set("name", …)` (found by reading the script, without running it), or an earlier send's script left that variable behind.
- Red, **No column or environment value**: nothing fills it, so it is sent as written.
- Grey, **Unused columns**: CSV columns the request does not use.

A CSV column with the same name as an environment variable wins. If the request has no placeholders at all, you are warned that every row sends the same request.

### Preview

**Preview** shows the first three requests exactly as they will be sent. It does not run scripts, so values a pre-request script would set are not filled in yet (the preview says so).

### Options

| Option | Meaning |
| --- | --- |
| **Concurrent requests** | How many are in flight at once, 1 to 50 (default 5). |
| **Delay between requests (ms)** | A pause before each request after the first, per worker. With 1 concurrent request this is the gap between requests, useful for rate-limited APIs. |
| **Count 4xx/5xx as failures** | On by default. Connection errors always count as failures. |
| **Stop on first failure** | No new requests start after a failure. Requests already in flight finish. |

Your option choices are remembered.

### Progress and results

While running you see a progress bar, done / total, passed and failed counts, elapsed time and average response time. **Stop** cancels the run; requests already sent are kept in the results.

The result table shows Row, Status, Time and URL. It can be filtered to **All** or **Failed**, shows 500 rows at a time (there is a control to show more), and clicking a row shows its full request, response, headers and notes. Results arrive as they complete, not in row order, and are sorted by row.

When a run ends (finished, stopped, or stopped after a failure) it is saved automatically, and a link **Open in run explorer and export reports →** appears.

### Scripts in a batch

If the request has scripts they run for every row. See [Scripting](scripting.md#csv-batch-runs-in-requests-mode). In short: `rr.data` is the row, `rr.iteration` is the 0-based row number, each row starts with its own copy of the script variables, and a row fails if its script errors or one of its `rr.test` checks fails. If the pre-request script fails the row is shown as not sent.

## Exporting a batch as a script

**Export script…** (next to **Preview**) saves the batch as a Python or Bash script that runs in a terminal without the app. The script holds the request, the run options, and the values of the selected environment. It reads a CSV file you give it, sends one request per row, prints a line per result, and writes a results CSV with the same columns as the app's [CSV report](#reports) (without the notes and script columns).

| | Python | Bash |
| --- | --- | --- |
| Needs | Python 3.8 or newer, no extra packages | bash 3.2 or newer and curl |
| macOS | `python3 my-request-batch.py data.csv` | `bash my-request-batch.sh data.csv` |
| Windows | `py my-request-batch.py data.csv` | Git Bash (comes with Git for Windows) or WSL: `bash my-request-batch.sh data.csv` |

If a CSV was loaded when you exported, its file name is the default, so the script finds it when it sits in the same folder.

Options (both scripts): `--concurrency N`, `--delay-ms N`, `--stop-on-failure` / `--no-stop-on-failure`, `--http-errors-fail` / `--no-http-errors-fail`, `--timeout SECONDS` (default 120), `--out FILE` (default `<csv name>-results-<time>.csv`), and `--dry-run` to print the requests without sending them. The defaults are the options you had set in the app. `--help` lists them.

The script fills placeholders with the same rules as the app: a CSV column wins, then the environment, then variables left by earlier sends' scripts. A placeholder with no value is sent as written. The CSV is read the same way too (separator detection, quotes, line breaks inside quotes). The exit code is 0 when every request passed and 1 when any failed or the run was stopped. Ctrl+C stops starting new requests and still writes the results.

Differences from a run in the app:

- **Pre-request and post-response scripts are not included.** They are JavaScript for the app's `rr` API. Values they set are not filled in, and their checks do not run. The export panel warns you when the request has scripts.
- **Environment values are copied into the script as plain text**, including tokens and passwords. Check the script before you share it. To change them, edit the settings block at the top of the script.
- Results go to the results CSV and the terminal. They do not appear in the app's run explorer.
- The Bash script applies the delay before each request after the first few (one per concurrent slot) rather than per worker. With 1 concurrent request it is the same gap between requests.

## The run explorer

Open a saved run from **Quick open → Batch runs**, from the **Earlier sends of this request** pills, or the link after a run. It shows:

- **Totals**: sent, passed, failed, total time, average, and 95th percentile response time.
- **Status code chips**: counts per status code (and `Error` for no response). Click one to filter the list.
- **The run log**: start, settings, environment, scripts, any placeholders with no value, first failure, why the run stopped, and the final count.
- **Every call**, searchable by row, URL, CSV value, note or script output. Use the up and down arrow keys to move through calls. Each call shows its notes, the CSV values, the full request, the response body, and the response headers, plus a Scripts tab when scripts ran.

Each call gets plain-language **notes** when something is worth knowing: a placeholder with no value, an HTTP error and whether it counted as a failure, no response, a JSON response that does not parse, a redirect status, a body cut short, and script errors, failed `rr.test` checks, or a post-response script that did not run because no response came back.

Buttons at the top of the explorer:

- **← Back to request**
- **Load this request**: opens the request as it was when the run started, on the Batch run tab.
- **Export HTML report**, **Export CSV report**
- **Delete**: removes the run (exported reports are not affected).

The last 30 runs are kept. Response bodies over 1 MB are cut to 1 MB when a run is saved, and the call's notes say so.

## Reports

Both exports open the native Save dialog in the app (in a plain browser they download).

**HTML report** is one self-contained file with a summary, the run details (request, data file and columns, environment), response-time stats, the run log, and every call as an expandable section. It has All / Failed / Passed filters, search, and Expand all. It opens in any browser, supports light and dark mode, and prints cleanly. All content is HTML-escaped.

**CSV report** has one line per call with these columns, in order:

`row`, `result` (PASS or FAIL), `status`, `status_text`, `duration_ms`, `sent_at`, `method`, `url`, `request_headers`, `request_body`, `response_headers`, `response_body`, `response_size_bytes`, `error`, `notes`, `script_tests`, `script_log`, then one `var:<column>` column per CSV column.

It is written with a UTF-8 byte-order mark so Excel opens it correctly. Environment values are not copied into the `var:` columns, so tokens do not end up in reports through them (a token that appears in a request header or body still does).
