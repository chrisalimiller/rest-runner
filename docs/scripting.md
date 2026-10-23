# Scripting reference (`rr`)

Scripts are short JavaScript programs that run **before a request is sent** (pre-request) or **after its response arrives** (post-response). They can set variables, read the response, and record pass/fail checks. They are available:

- on every request in Requests mode (the **Scripts** section), including each row of a [CSV batch run](batch-runs.md);
- on every [test case](testing.md) (the **Pre-request** and **Post-response** tabs).

The same `rr` API is used everywhere.

- [When scripts run](#when-scripts-run)
- [Quick example](#quick-example)
- [`rr.vars`](#rrvars): read and write variables
- [`rr.data`, `rr.env`, `rr.iteration`, `rr.caseName`](#other-values)
- [`rr.request`](#rrrequest)
- [`rr.response`](#rrresponse) (post-response only)
- [`rr.test` and `rr.expect`](#rrtest-and-rrexpect): checks
- [`rr.log` and `console`](#logging)
- [Errors, timeouts and limits](#errors-timeouts-and-limits)
- [Variable scoping](#variable-scoping)
- [Recipes](#recipes)
- [Editor help: snippets and autocomplete](#editor-help)

## When scripts run

| Where | Order |
| --- | --- |
| **Send** in Requests mode | pre-request script → placeholders filled → request sent → post-response script |
| **Each row of a CSV batch** | the same sequence, once per row |
| **A test case** | request's pre-request script, then the case's pre-request script (as one script) → request sent → request's post-response script, then the case's post-response script (as one script) → assertions → status check |

Details that matter:

- The pre-request script runs **before** placeholders are filled, so a variable it sets with `rr.vars.set()` can be used as `{{name}}` in the same request.
- If the pre-request script **throws** (or times out), the request is **not sent**. In Requests mode the response pane says so and links to the script output. In a batch the row shows as not sent and fails. In Testing the case fails.
- The post-response script runs only if a **response** came back. A 404 or 500 is a response, so the script runs. A connection error is not, so it does not (the call's notes say so).
- A script cannot change the request. `rr.request` is a read-only copy. The way a script affects the request is by setting variables that the request uses as `{{placeholders}}`.
- In a test case, the request's own scripts and the case's scripts run together as one script, request first. Each part sits in its own `{ … }` block, so `const` and `let` names in one do not clash with the other, and are not visible to the other. (Share data between them with `rr.vars.set()` and `rr.vars.get()`.)

## Quick example

Request 1, a login, with this **post-response** script:

```js
rr.test("Logged in", () => {
  rr.expect(rr.response.status).toBe(200);
});
rr.vars.set("token", rr.response.json().token);
```

Request 2 uses `Bearer {{token}}` in its Auth section, or an `Authorization` header of `Bearer {{token}}`. After sending request 1, request 2 picks up the token. The value is kept between sends (see [scoping](#variable-scoping)).

## `rr.vars`

Variables are **strings**. Run variables are what scripts set. `rr.vars` also reads the CSV row and the environment, so one call finds a value from any source.

| Member | Description |
| --- | --- |
| `rr.vars.get(name)` | The value of `name`, or `undefined`. Looks in run variables first, then the CSV row (`rr.data`), then the environment (`rr.env`). |
| `rr.vars.set(name, value)` | Sets a run variable. A string is stored as is. Any other value is stored as its JSON text: `5` becomes `"5"`, `{a:1}` becomes `'{"a":1}'`, `null` becomes `"null"`, `undefined` becomes `"undefined"`. The name is converted to a string. Later requests, and later cases in the same iteration, see it as `{{name}}`. |
| `rr.vars.unset(name)` | Removes a **run** variable. A CSV column or environment variable of the same name is not affected, so `get(name)` may still return that. |
| `rr.vars.has(name)` | `true` if `name` exists as a run variable, a CSV column or an environment variable. |
| `rr.vars.all()` | A copy of everything as one object: environment, overridden by the CSV row, overridden by run variables. |

Because values are strings, convert when you need numbers: `Number(rr.vars.get("count"))`.

When the request is prepared, `{{name}}` is looked up with this priority (later wins): **environment, then CSV row, then run variables**. The one exception is covered under [scoping](#csv-batch-runs-in-requests-mode).

## Other values

| Member | Description |
| --- | --- |
| `rr.data` | The current CSV row as an object of strings, for example `rr.data.username`. Read-only. `{}` when there is no CSV (single sends, suites without data). |
| `rr.env` | The selected environment's enabled variables as an object. Read-only. `{}` when no environment is selected. |
| `rr.iteration` | The 0-based number of the current iteration. For a single send it is `0`. For a batch it is the 0-based CSV row. For a suite run it counts through every repeat and every CSV row. |
| `rr.caseName` | The test case's name in Testing, or the request's name in Requests mode. |

`rr.data`, `rr.env`, `rr.request` and `rr.response` are frozen: assigning to their properties throws an error (`Cannot add property x, object is not extensible`, or `Cannot assign to read only property`).

## `rr.request`

The request, as a read-only object.

| Member | Description |
| --- | --- |
| `rr.request.method` | `"GET"`, `"POST"`, … |
| `rr.request.url` | The URL. |
| `rr.request.headers` | An array of `[name, value]` pairs. |
| `rr.request.body` | The body text, or `undefined` when there is none. |
| `rr.request.header(name)` | The value of a header (name matched in any case), or `undefined`. |

What you get depends on the phase:

- **In a pre-request script** you see the request **as written**: the URL still contains `{{placeholders}}` and has no query params appended, headers are your enabled header rows only (no auth header or default Content-Type), and the body is the raw template.
- **In a post-response script** you see the request **as it was sent**: placeholders filled, query params appended, auth and default headers added, and the final body.

## `rr.response`

Available in **post-response** scripts only. In a pre-request script `rr.response` is `undefined`, so using it throws a `TypeError`.

| Member | Description |
| --- | --- |
| `rr.response.status` | Status code, e.g. `200`. |
| `rr.response.statusText` | Status text, e.g. `"OK"`. May be empty. |
| `rr.response.time` | Response time in milliseconds. |
| `rr.response.size` | Body size in bytes. |
| `rr.response.body` | The body as a string. |
| `rr.response.text()` | Same as `body`. |
| `rr.response.json()` | The body parsed as JSON. Throws `Response body is not valid JSON` if it does not parse. The parse happens once and is reused. |
| `rr.response.headers` | An array of `[name, value]` pairs. |
| `rr.response.header(name)` | The value of a header (name in any case), or `undefined`. If the header appears more than once, the values are joined with `, `. |

## `rr.test` and `rr.expect`

`rr.test(name, fn)` runs `fn` and records a check named `name`. If `fn` returns normally, the check passes. If it throws (which is what a failed `rr.expect` does), the check fails with the error message. A failed test **does not stop the script**; the next lines still run.

```js
rr.test("Status is 200", () => {
  rr.expect(rr.response.status).toBe(200);
});
```

`fn` must be synchronous. A function that returns a Promise (for example an `async` function) is recorded as a failed check with the message `rr.test functions cannot be async`.

Where checks show up:

- **Requests mode, single send:** the **Scripts** tab of the response, with a pass or fail mark per check. The tab turns red if any fail.
- **CSV batch:** the call's **Scripts** tab in the run explorer, in the call's notes, and in the `script_tests` column of the CSV report. A row with a failed check is counted as failed.
- **Testing:** each `rr.test` is a check of the case, listed with the assertions. The case passes only if all checks pass.

### Matchers

`rr.expect(actual)` returns an object with the matchers below. Each also exists after `.not` (for example `rr.expect(x).not.toBe(1)`). A failing matcher throws an error such as `Expected 1 to be 2`, or `Expected not: 1 to be 1` after `.not`.

| Matcher | Passes when |
| --- | --- |
| `toBe(expected)` | `Object.is(actual, expected)`: same value and type. For objects, the same object. |
| `toEqual(expected)` | Deep equality of objects and arrays (by keys and values). |
| `toBeTruthy()` / `toBeFalsy()` | The value is truthy / falsy. |
| `toBeDefined()` / `toBeUndefined()` | The value is not / is `undefined`. |
| `toBeNull()` | The value is `null`. |
| `toBeGreaterThan(n)` | A number greater than `n`. |
| `toBeGreaterThanOrEqual(n)` | A number at least `n`. |
| `toBeLessThan(n)` | A number less than `n`. |
| `toBeLessThanOrEqual(n)` | A number at most `n`. |
| `toContain(item)` | For a string: it includes `item` as text. For an array: some element deep-equals `item`. |
| `toMatch(pattern)` | A string that matches the regular expression (a `RegExp` or a string that is turned into one). |
| `toHaveProperty(key)` | An object with its own property `key` (a single key, not a path). |
| `toHaveLength(n)` | An array or string whose `length` is `n`. |

The number matchers fail if `actual` is not a number. Remember that variables and CSV values are strings: write `rr.expect(Number(rr.vars.get("n"))).toBeGreaterThan(0)`.

A matcher called **outside** `rr.test` that fails throws straight out of the script. That ends the script with an error (shown as "Script error"), skips the rest of it, and counts as a failure. Prefer putting matchers inside `rr.test` so that each check is reported on its own.

## Logging

`rr.log(...values)` and the `console` methods `log`, `info`, `warn`, `error` and `debug` all do the same thing: they add a line to the script's output. Values are joined with spaces. Strings are used as is, an `Error` becomes its message, and anything else is turned into JSON.

```js
console.log("status", rr.response.status, rr.response.json());
```

Where the output shows: the **Scripts** tab (single send), the call detail (batch and test runs), the HTML reports, and the `script_log` (batch) or `script_output` (Testing) column of the CSV reports. Lines are labelled `[pre]` or `[post]` in the CSV.

## Errors, timeouts and limits

- **Synchronous only.** A script runs top to bottom and then finishes. You cannot wait for anything: `await` at the top level is a syntax error, and a timer or promise that resolves later is not waited for. To use one response in another request, put the value in a variable with `rr.vars.set()` and use `{{name}}` in the next request or case.
- **Strict mode.** Scripts run with `"use strict"`, so assigning to an undeclared name (`y = 1`) throws `ReferenceError: y is not defined`. Declare with `const` or `let`.
- **A thrown error ends the script.** The message is shown as the script's error, for example `TypeError: Cannot read properties of undefined (reading 'deep')`. Checks and variable changes made *before* the error are kept. An error counts as a failure: the pre-request script's error stops the send; the post-response script's error fails the row, case or send. Syntax errors are reported the same way (`SyntaxError: Unexpected token ';'`).
- **Time limit.** Scripts run in a background worker, so a bad loop cannot freeze the app. A script that runs past its limit is stopped and fails with `Script did not finish within N ms and was stopped`. Variable changes it made are discarded, and other scripts and requests carry on.

  | Where | Limit |
  | --- | --- |
  | Requests mode (single send and CSV batch) | 5000 ms, fixed |
  | A test case | The suite's **Script time limit (ms)** under **Run settings & data** (default 5000, minimum 100). Applies to each script run, and **Try case** uses it too. |

- **Fresh each time.** Each run of a script starts with a new scope. Do not rely on globals surviving from one run to the next. Use variables.
- **No outside access.** There is no `require` or `import`, and no page access (`document`, `window`). Standard JavaScript built-ins (`JSON`, `Math`, `Date`, `RegExp`, `Array`, `String`, `Number`, …) are available.

## Variable scoping

Where variables live, and how long, depends on where the script runs.

### Single sends in Requests mode

- **Script variables are global and persistent.** Every request shares one set. A variable set by one request's script can be used by any other request, and is saved between launches of the app.
- They are listed under the script editor (**Script variables**). **Clear** forgets all of them.
- After a send of a request that **has a script**, the script variables become whatever the scripts left (including anything unset). A request with no scripts leaves them untouched.
- They are also used for the resolved URL line, the placeholder check and the preview, in addition to environment values.
- Priority for `{{name}}`: environment, then script variables.

### CSV batch runs in Requests mode

- Each row's scripts start with a **copy** of the script variables as they were when the run began (for example, a token from an earlier login send).
- A row's changes belong to that row only. Rows do not see each other's variables, even when rows run at the same time, and the batch does not write anything back to the saved script variables.
- `rr.data` is the row and `rr.iteration` is the 0-based row number.
- Priority for `{{name}}` in a row: environment, then the CSV row, then script variables, with one exception: a **leftover** script variable (from before the run) with the same name as a CSV column is dropped at the start of the row, so the CSV column wins. A variable the row's own script sets with that name still overrides the CSV.
- A row fails if the request fails (connection error, or 4xx/5xx when that option is on) **or** its script errors **or** one of its checks fails.

### Testing

- Run variables **start empty for every iteration** (each CSV row, and each repeat). Variables set in Requests mode are not visible here.
- **Sequential** and **Iterations in parallel**: the cases of one iteration run in order and share one set of variables, so a value set in case 1 is available as `{{name}}` (and `rr.vars.get`) in case 2. Different iterations never see each other's variables, even in parallel.
- **Cases in parallel**: each case starts with an empty set, so cases cannot pass values to each other.
- **Try case** (one case on its own) starts empty too, and uses the first CSV row as its `rr.data`. Values set by earlier cases are not available.
- Priority for `{{name}}`: environment, then the CSV row, then run variables. Assertion expected values and properties are filled in the same way, *after* the post-response script ran, so they can use variables the script just set.
- Variables set by a case's scripts are listed on the case ("Passes on") and in the run report.

## Recipes

**Save a value from the response for later requests**

```js
rr.vars.set("userId", rr.response.json().user.id);
```

**Build a value from the CSV row** (pre-request)

```js
rr.vars.set("email", rr.data.username.toLowerCase() + "@example.com");
```

**A unique id or timestamp per request** (pre-request)

```js
rr.vars.set("requestId", "req-" + Date.now() + "-" + rr.iteration);
```

**Check several things about the body**

```js
const body = rr.response.json();

rr.test("Returns the right user", () => {
  rr.expect(body.user.id).toBe(Number(rr.data.id));
});
rr.test("Has two items", () => {
  rr.expect(body.items).toHaveLength(2);
});
rr.test("Response is fast", () => {
  rr.expect(rr.response.time).toBeLessThan(500);
});
```

**Check a header**

```js
rr.test("Returns JSON", () => {
  rr.expect(rr.response.header("content-type")).toContain("json");
});
```

**Only check the body when the call succeeded**

```js
rr.test("Status is 200", () => rr.expect(rr.response.status).toBe(200));
if (rr.response.status === 200) {
  rr.vars.set("token", rr.response.json().token);
}
```

**Use a number from the response**

```js
const total = Number(rr.response.header("X-Total"));
rr.test("Enough results", () => rr.expect(total).toBeGreaterThan(10));
```

**Fail the row if a variable is missing** (pre-request: a throw stops the send)

```js
if (!rr.vars.has("token")) {
  throw new Error("No token yet. Send the login request first.");
}
```

**Read an environment value**

```js
console.log("Using", rr.env.baseUrl, "or", rr.vars.get("baseUrl"));
```

## Editor help

- **Autocomplete:** type `rr.` (or press Ctrl + Space) for a list of `rr` members with short descriptions. Response members are offered only in post-response scripts.
- **Snippets:** the list beside the editor inserts ready-made code at the end of the script:
  - Post-response: *Status is 200*, *Response time under 500 ms*, *JSON field has a value*, *Save a JSON field to a variable*, *Header contains*, *Log the response*.
  - Pre-request: *Set a variable*, *Use a CSV value*, *Random number*.
  - Both: *Read a variable*.
- **Passes on (Testing):** under a case, the app lists the variables its scripts set, read from the code without running it. It finds calls like `rr.vars.set("token", …)` with a literal name. Calls with a computed name, calls in comments, and repeats of the same name are skipped. The same detection feeds the "From scripts" group in the [batch placeholder check](batch-runs.md#the-placeholder-check).
