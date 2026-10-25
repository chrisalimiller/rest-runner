# Flows

> **Status:** the flow engine is in place. The **Flows** mode with its canvas arrives in the next update; this page describes how a flow runs so the rules are written down before the editor lands.

A **flow** chains your saved work into one run. You place **steps** (nodes) on a canvas and wire them together. Each step runs a test case, a whole suite or a saved request, or controls what happens next. A flow runs inside the open app, with the environment selected in the Flows top bar.

## Steps

| Step | What it does | Outputs |
| --- | --- | --- |
| **Start** | Where a run begins. A flow has exactly one. | next |
| **Run case** | Runs one case from a suite, with its scripts and assertions, using that suite's run settings (for example "4xx/5xx fail the case" and the script time limit). It runs once and does not use the suite's CSV. | passed, failed |
| **Run suite** | Runs a whole suite exactly like **Run suite** in Testing: its run order, repeat count and CSV data. It passes when every case in every iteration passes. | passed, failed |
| **Run request** | Runs a saved request (or saved example) with its pre-request and post-response scripts. It passes when a response comes back and every `rr.test` in its scripts passes. A 4xx or 5xx on its own does not fail it; add an `rr.test` on the status if you want that. | passed, failed |
| **If** | Checks a condition and goes down **true** or **false**. See [Conditions](#conditions). | true, false |
| **Wait** | Pauses for a set time. **Stop** cuts it short. | next |
| **Set variable** | Sets a flow variable. The value can use `{{placeholders}}` from the environment and earlier steps. | next |

Run steps point at the **live** case, suite or request, by id. They do not copy it, so editing a case in Testing changes what the flow runs. A step whose item was deleted shows a warning, and the flow won't start until it is fixed. Each run uses the items as they are when the run starts.

## Wires and order

- A run starts at **Start** and follows one wire at a time.
- Each output can have **one** wire. A step can receive any number of wires, so several paths can meet at the same step.
- Wires can loop back to an earlier step (for example: run a request, **If** it is not ready, **Wait**, then run it again). A flow that goes round more than 1,000 steps is stopped and marked failed, in case a loop never ends.
- The run ends when it reaches an output with nothing wired to it.

## Passing and failing

- A Run step that fails follows its **failed** wire.
- If nothing is wired to **failed**, the flow stops there and is marked **Failed**.
- If the failed wire was followed and the flow reaches its end, the flow is marked **Passed**. The report still counts how many Run steps failed, so a handled failure stays visible.
- **Stop** ends the run at once and marks it **Stopped**.

## Retry

Every Run step has a **Retry** setting: try again up to N times, waiting a set time before each new try. The step passes as soon as one try passes, and fails if every try fails. Each try starts from the flow variables as they were when the step began, so a failed try's `rr.vars.set` calls don't leak into the next try. The report lists every try with its time and why it failed.

## Flow variables

Each flow run has one set of **flow variables**, which starts empty.

- A value a script sets with `rr.vars.set()` is visible to every later step, the same way cases share variables inside a suite run. Read it with `{{name}}` or `rr.vars.get("name")`.
- **Set variable** steps write to the same set.
- The selected environment sits underneath: a flow variable with the same name as an environment variable wins.
- **Run suite** starts every iteration (CSV row or repeat) from the current flow variables. When the suite finishes, the variables of the iteration that finished last carry on to later steps. In the "cases in parallel" run order, cases can't pass variables to each other or back to the flow.

## Conditions

An **If** step checks one condition, built like an assertion:

| Check | Reads |
| --- | --- |
| **Last step result** | `passed` or `failed`, for the last Run step |
| **Variable** | A flow variable by name (or an environment variable) |
| **Status code, Response time, Response size, Header, Body, JSON path** | The response of the last Run step that got one. For **Run suite**, that is the last case to finish |

Expected values can use `{{placeholders}}`. When there is nothing to check yet (no Run step has run, or no response came back), the condition counts as **false**, and the report says why.

## Reports

Every step is recorded in order with its status, time, the output it took, and the flow variables before and after. Each Run step keeps the full suite or case report of its last try, the same report Testing shows.
