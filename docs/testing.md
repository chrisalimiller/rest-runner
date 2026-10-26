# Testing

Testing mode (the **Testing** tab at the top right) runs **test suites**. A suite is an ordered list of **test cases**. A case is a request plus checks. Run the suite and you get a pass/fail report for every case, with the full request and response behind each result.

## The Testing window

- **Left:** your **Suites** (with **New**, **Import** and **Export**) and your **Test runs**. Below 800 px wide this becomes a drop-down.
- **Name in the top bar:** click the suite name to switch suites. The list on the left can be hidden with **«**; this is remembered.
- **Middle:** the open suite, read as a runbook: one step per case, each with a status disc (✓ passed, ✕ failed, a number when it has not run, a grey number when skipped, a spinner while running). One case is open at a time.
- **Right:** the **Last run** panel, then live progress while a suite runs. Below 1200 px wide it moves under the suite.
- **Top bar:** Quick open, and an environment switch of its own. The pencil is not shown here: environments are edited in Requests mode, and this switch picks them up when you come back to Testing.

## Suites

- **New** (left) creates a suite. Click a suite in the list to open it.
- The suite header has its **name** and **description** (edit in place), a summary line (cases, run order, CSV, repeat, script limit), **Run settings & data**, and **Run suite** (**Stop** while running).
- In the ⋯ menu of the suite header: **Duplicate suite** and **Delete suite**. Deleting does not ask; an **Undo** toast appears for 8 seconds. Saved test runs are kept either way.
- Suites are saved automatically as you edit.

## Test cases

Add cases at the bottom of the suite:

- **+ From saved request** opens a picker over your collections (including examples). Search by name, folder or URL, tick several, and add them. Each case gets **its own copy** of the request. Changing the case does not change the saved request, and the other way round.
- **+ Blank case** starts from an empty request.

Each case card has:

- A header with a checkbox to include or skip it in runs, its name, "from saved request" when it was copied from one, **Try case** (sends this one case now, with its scripts and assertions; see [Try case](#try-case)), and a collapse button.
- A **⋯** menu with **Move up**, **Move down**, **Duplicate**, **Delete case**, and (if it was made from a saved request) **Update from saved request**, which replaces the case's request (including the request's own scripts) with the current saved version, after a confirmation. The case's own Pre-request and Post-response scripts and its assertions are kept.
- A request summary line (method, URL, "Params 1 · Bearer · Headers 3 · JSON body") and **Edit request**, which opens the same request editor as Requests mode in a dialog (params, auth, headers, body, and the request's own scripts). Changes apply to this case only. The request's scripts run before the case's own (see [Scripting](scripting.md#when-scripts-run)).
- Tabs: **Assertions**, **Pre-request** and **Post-response**. A bullet marks scripts that have content, and the Assertions tab shows how many are enabled.
- **Passes on**: below the tabs, lists the variables the case's scripts set with `rr.vars.set("name", …)`, with the expression, and the last value seen.

A new case starts with one assertion, "Status code equals 200".

### Assertions

Assertions are no-code checks in a table. Each row has an on/off checkbox, a **Check**, a **Property** (when the check needs one), a **Condition** and an **Expected** value.

| Check | Property | Conditions available |
| --- | --- | --- |
| **Status code** | | equals, does not equal, is less than, is at most, is greater than, is at least |
| **Response time (ms)** | | is less than, is at most, is greater than, is at least |
| **Response size (bytes)** | | is less than, is at most, is greater than, is at least, equals |
| **Header** | header name, e.g. `Content-Type` (any case) | equals, does not equal, contains, does not contain, exists, does not exist, matches regex |
| **Body** | | contains, does not contain, equals, matches regex |
| **JSON path** | path, e.g. `$.data[0].id` | equals, does not equal, contains, does not contain, exists, does not exist, is less than, is at most, is greater than, is at least, matches regex, is of type |

How they compare:

- **Status equals**: type an exact code (`200`) or a class (`2xx`, `4xx`, …; `does not equal` works with classes too).
- **equals** on a JSON path or header: a string value must match the text exactly. For other values the expected text is read as JSON when it parses, so `42`, `true`, `null`, `[1,2]` and `{"a":1}` compare by value (objects and arrays deeply). Otherwise it is compared as text.
- **contains**: text includes the expected text; an array has an element equal to the expected value (`3` finds the number 3 or the text "3"); an object has a key of that name.
- **does not contain** also fails when the value does not exist.
- **exists** passes when the value is present (a JSON `null` counts as present). **does not exist** passes when it is missing, such as a header the response lacks or a JSON path that leads nowhere.
- **is less than / at most / greater than / at least**: both sides are read as numbers (numeric text is fine). If either side is not a number the assertion fails with a message saying so.
- **matches regex**: a JavaScript regular expression tested against the text (a non-text JSON value is tested as its JSON text). An invalid expression fails with a message.
- **is of type**: one of `string`, `number`, `boolean`, `array`, `object`, `null`.
- **Expected** and **Property** may contain `{{placeholders}}`, filled from the environment, the CSV row, and run variables (including ones a post-response script has just set).

**JSON path syntax** (a small subset): `$.data.items[0].id`, a path without the leading `$` (`items[0].name`), bracket keys for odd names (`$["key with spaces"]`), negative indexes counted from the end (`$.items[-1]`), and `.length` for the length of an array or string (`$.items.length`). Wildcards (`[*]`) are not supported. A step that does not exist gives "missing", not an error.

On a narrow card (under 560 px) Last result moves under each Expected value instead of taking its own column.

The **Last result** column shows each assertion's outcome (✓ or ✕) and the value seen, from the last **Try case** or, if none, the latest run of the suite.

## Run settings & data

**Run settings & data** (header button) opens a sheet. Settings are saved with the suite.

### Planned runs

At the top of the settings a line states what a run will do, for example **12 iterations × 5 cases = 60 case runs**, taking the CSV rows, repeat count and disabled cases into account. **Concurrency** is shown only for the parallel run orders.

### Run order

| Mode | What it does |
| --- | --- |
| **Sequential** | One case at a time, in order. Values set by a case carry to the next case in the same iteration. |
| **Iterations in parallel** | Several iterations (CSV rows or repeats) run at once. Inside each iteration the cases still run in order and share variables. |
| **Cases in parallel** | Iterations run one after another, but all the cases of an iteration start together. Cases cannot pass variables to each other. |

### Options

| Option | Meaning |
| --- | --- |
| **Concurrency** | The most requests in flight in the two parallel modes (1 to 50; ignored in Sequential). |
| **Delay (ms)** | A pause between cases, per worker. |
| **Repeat** | Go through the data this many times (1 to 1000). With 3 CSV rows and Repeat 2 the order is rows 1, 2, 3, 1, 2, 3. Without a CSV it runs the suite that many times. |
| **Script time limit (ms)** | Scripts that run longer are stopped and fail the case. Default 5000, minimum 100. |
| **Stop on first failed case** | No new cases start after one fails. |
| **4xx/5xx fail a case that has no status assertion** | On by default. See [how a case passes](#how-a-case-passes). |

### Data (CSV)

**Choose CSV…** attaches a CSV file to the suite. The suite then runs **once per row**, and `{{column}}` placeholders are filled from that row. The same parsing rules apply as in [batch runs](batch-runs.md#the-csv-file) (header row, delimiter detection, warnings). A preview shows the first five rows. **Replace CSV…** swaps it and **Remove** detaches it. The CSV is saved with the suite, up to 2 MB. A larger file is used for the next run but is not saved, and a notice says so.

Scripts see the current row as `rr.data` and its position as `rr.iteration`.

### Placeholders

The sheet lists every placeholder used by the enabled cases: green when a CSV column or the selected environment supplies it, red when nothing does, and plain when only a script mentions it (set with `rr.vars.set`).

A line at the bottom says what the next run will do, for example "3 cases × 4 iterations = 12 requests".

## Running a suite

Press **Run suite**. Only one suite can run at a time, and Requests mode keeps working meanwhile. You see live progress, with each result as it lands. **Stop** ends the run early; results so far are kept.

### How a case passes

For each iteration, a case runs like this:

1. Request's pre-request script, then the case's pre-request script. If they fail, the request is not sent and the case fails.
2. The request is sent, with `{{placeholders}}` filled from the environment, the CSV row, and run variables.
3. If no response arrives, the case fails with a "Response received" check, and the assertions and post-response script are skipped.
4. Post-response scripts run (request's, then the case's).
5. Each enabled assertion is evaluated.
6. If **4xx/5xx fail a case…** is on and the case has no enabled Status code assertion, a check "Status is below 400" is added. A case with its own status assertion is judged by that assertion alone, so you can test that an endpoint returns 404.

A case **passes when every check passes**: its enabled assertions, every `rr.test` in the scripts, both scripts finishing without an error, and a response arriving. A case with no checks at all passes whenever a response comes back, and its notes say so.

Each result also gets plain-language notes (placeholders that had no value, an HTTP status that was judged by the case's own assertion, and so on).

### Reordering cases

The numbered circle at the left of each case is its drag handle. Drag it up or down, or focus it and press **Space** to pick the case up, **↑ / ↓** to move it, **Space** to drop it (**Esc** puts it back). A screen reader announces the position as it moves. **Move up** and **Move down** in the ⋯ menu do the same one step at a time.

### While a run is going

The suite header reads **Running · iteration 3 of 12** (or **Running · 2 of 5** for a single pass) and each case's disc shows a spinner with how many times it passed and failed so far, for example ✓3 ✕1. Cases cannot be edited while a run is in progress; they are read-only and the header says **Edits apply to the next run**.

### Try case

**Try case** sends one case on its own using the suite's settings, so you can build a case without running everything. It uses the first CSV row (if the suite has data) and starts with no run variables, so values that earlier cases would have set are missing. The result appears under the case ("Last try") and fills the **Last result** column. The **▾** next to Try case opens **Try up to here**: it runs the enabled cases before this one, then this one, once each, using the first CSV row. Variables set by earlier cases carry forward, as in a sequential run, so a case that needs a token from a login case can be tried without running the whole suite. Disabled cases are skipped (the case you pressed it on always runs), and it stops at the first failure when the suite is set to stop on failure. Each case shows its own try result. Starting a suite run clears the try results of that suite's cases, so Last result then reflects the run.

## Reports

When a run ends it is saved (the last 50 runs are kept, as Test runs in the sidebar, with the passed and failed counts). The **Last run** panel shows the latest run of the open suite: cases passed, a pass/fail bar, iterations, checks, average time, 95th percentile, and the failures **grouped by case and check**, most frequent first, for example "Get ticket · Response time < 250 ms · 8 of 12 rows · worst 371 ms". Click a group to open the report filtered to that case and check. A case that failed without a check (a script error, or no response) appears as "Not sent", "No response" or "Failed". In the report, **Failures first** (on by default for runs that used CSV data) lists failed rows before passed ones, and a chip shows the case and check filter. **Export HTML** and **Export CSV** are in the panel.

Opening a run (from the sidebar, the panel, or Quick open) shows the full report. For a run that used a CSV file, switch **List / Grid** above the results: the grid has one row per CSV row and one column per case, each cell green or red with its status code, failures first when that is on. Click a cell to open that result.

- Totals: cases and checks passed, timing, average and 95th percentile response.
- **By test case** table. Click a case to show only its results.
- The run log: start (cases × iterations, data file), run order, environment, first failure, how it ended, final count.
- Every result, searchable by case, URL, value or check. Each shows its checks (pass or fail with the value seen), notes, variables, the request, response, headers, and script output.
- **Export HTML report** and **Export CSV report**, and **Delete run** in the ⋯ menu (no confirmation; an **Undo** toast appears for 8 seconds). Report exports always mask [secret values](requests.md#secret-values).

The **HTML report** is a self-contained file with the same content, filters (All / Failed / Passed), search, a clickable case table, and Expand all. The **CSV report** has one line per case per iteration with these columns:

`iteration`, `csv_row`, `repeat`, `case_number`, `case`, `result`, `checks_passed`, `checks_total`, `failed_checks`, `all_checks`, `status`, `duration_ms`, `started_at`, `method`, `url`, `request_headers`, `request_body`, `response_headers`, `response_body`, `error`, `script_output`, `notes`, then a `var:<column>` column per CSV column.

Response bodies over 1 MB are cut to 1 MB in saved runs.

## Exporting suites

In the Testing sidebar, **Export** writes every suite (cases, assertions, scripts, options and saved CSV data) to one JSON file, and **Import** merges such a file: a suite with the same id is replaced, others are added. A file that is not a REST Runner test-suites file is rejected. Test runs are not included. Export their reports instead.
