# Flows

A **flow** chains your saved work into one run. You place **steps** (nodes) on a canvas and wire them together. Each step runs a test case, a whole suite or a saved request, or controls what happens next. A flow runs inside the open app, when you press **Run** or when one of its [schedules](#schedules) comes due, with the environment selected in the Flows top bar.

## The Flows window

Open it with the **Flows** tab at the top right.

- **Left:** your **Flows** (with **New**, **Import** and **Export**) and recent **Flow runs**. A flow with a schedule shows when it runs next, and the last run it skipped. Below 1000 px wide this becomes a drop-down.
- **Middle:** the flow's name and description (edit in place), undo and redo buttons, a ⋯ menu with **Export**, **Duplicate** and **Delete flow**, and **Run** (**Stop** while running). Under that, the **step bar**, then the **canvas**.
- **Right:** the settings of the selected step. With nothing selected: anything that stops the flow from running, then the live run or the latest run.
- **Top bar:** Quick open, and an environment switch of its own. Environments are edited in Requests mode.

Flows are saved automatically as you edit. Like the other modes, Flows stays alive while you switch away, so a running flow carries on.

## Building a flow

- **Add a step:** click it in the step bar (it lands in the middle of the canvas), or drag it onto the canvas.
- **Wire steps:** drag from an output dot on the right of a step to the input dot on the left of another. Dragging a new wire from an output that already has one replaces the old wire.
- **Select** a step to edit it on the right. **Delete** or **Backspace** removes the selected step or wire; so does **Delete step** in its settings. Nothing asks first; use [undo](#undo).
- **Move around:** drag the background to pan, scroll or pinch to zoom, and use the buttons at the bottom left to zoom or fit the flow. The small map at the bottom right also pans and zooms.
- **Opening view:** a flow opens at a readable size: the whole flow when it fits at 70% zoom or more, otherwise 100% zoom centred on Start. The fit button does the same. Manual zoom goes down to 30%; below 60% each card shows just its colour and name.
- **Tidy layout** (top right of the canvas) arranges the steps left to right with 80 px between columns and 40 px between rows, in the order of their wires. Start stays where it is and sticky notes move with the step they sit closest to. You can undo it.

### Undo

**Ctrl/Cmd + Z** undoes your last edit to the open flow (up to 50 steps back) and **Ctrl/Cmd + Shift + Z** (or **Ctrl + Y**) redoes it. This covers moving, adding and deleting steps and wires, notes, step settings and renames. It is off while the cursor is in a text field. The ↶ and ↷ buttons in the flow header do the same. Deleting a whole flow shows an **Undo** toast for 8 seconds instead.
- **Name:** every step has an optional name. Empty, it shows the case, suite or request it runs.
- **Sticky notes** hold free text to explain a flow. Type straight into the note; drag its top edge to move it and its corners to resize it. Notes are never run and can't be wired.

A red **!** on a step means the flow can't run until it is fixed (for example, a deleted case). A yellow one is a warning, such as a step nothing is wired to. The right-hand panel lists them; click one to jump to the step. **Run** stays off while there is an error.

## Running

Press **Run**. The run begins at **Start** (or, in a flow with no Start and one Schedule, at the Schedule) and the step running now shows a spinner. Finished steps turn green or red, and the right-hand panel lists every step with its result, time and the wire it took. Click a step there for its notes, tries, the case and check counts, and the variables it changed. **Show on canvas** finds the step.

Finished runs are saved (the last 50) and listed under **Flow runs**. Opening one shows its [report](#reports). **Open report** under the result in the right-hand panel does the same for the run you just watched.

Different flows can run at the same time (for example, a scheduled flow while you run another one by hand). The same flow runs once at a time. You can keep editing while it runs; the run uses the flow as it was when it started.

## Steps

| Step | What it does | Outputs |
| --- | --- | --- |
| **Start** | Where a run begins when you press Run. A flow has at most one. | next |
| **Schedule** | Starts the flow on a timer while the app is open. See [Schedules](#schedules). Nothing can be wired into it. | next |
| **Run case** | Runs one case from a suite, with its scripts and assertions, using that suite's run settings (for example "4xx/5xx fail the case" and the script time limit). It runs once and does not use the suite's CSV. | passed, failed |
| **Run suite** | Runs a whole suite exactly like **Run suite** in Testing: its run order, repeat count and CSV data. It passes when every case in every iteration passes. | passed, failed |
| **Run request** | Runs a saved request (or saved example) with its pre-request and post-response scripts. It passes when a response comes back, every `rr.test` in its scripts passes, and the status is below 400. Each Run request step has a **4xx/5xx counts as failed** checkbox in its settings (on by default); turn it off for a step where an error response is expected and you check it yourself. The card shows the status code of its last response. | passed, failed |
| **If** | Checks a condition and goes down **true** or **false**. See [Conditions](#conditions). | true, false |
| **Parallel** | Starts every step wired to **branches** at the same time. See [Parallel and Join](#parallel-and-join). | branches (any number of wires) |
| **Join** | Waits for every branch of the Parallel before it, then continues. Fails if any branch failed. | passed, failed |
| **Loop over CSV** | Runs the steps wired to **each row** once per row of a CSV file, then continues from **done**. See [Loop over CSV](#loop-over-csv). | each row, done |
| **Wait** | Pauses for a set time. **Stop** cuts it short. | next |
| **Set variable** | Sets a flow variable. The value can use `{{placeholders}}` from the environment and earlier steps. | next |

Run steps point at the **live** case, suite or request, by id. They do not copy it, so editing a case in Testing changes what the flow runs. A step whose item was deleted shows a warning, and the flow won't start until it is fixed. Each run uses the items as they are when the run starts.

## Wires and order

- A run starts at **Start** and follows one wire at a time.
- Each output can have **one** wire, except a Parallel's **branches**, which takes any number. A step can receive any number of wires, so several paths can meet at the same step.
- Wires can loop back to an earlier step (for example: run a request, **If** it is not ready, **Wait**, then run it again). A flow that goes round more than 1,000 steps is stopped and marked failed, in case a loop never ends.
- The run ends when it reaches an output with nothing wired to it.

## Passing and failing

- A Run step that fails follows its **failed** wire.
- If nothing is wired to **failed**, the flow stops there and is marked **Failed**.
- If the failed wire was followed and the flow reaches its end, the flow is marked **Passed with handled failures** (amber). A flow is **Passed** (green) only when no Run step failed on the way. A flow with an unhandled failure is **Failed**. The report counts how many Run steps failed in every case.

> **Older flows:** Run request steps saved before the checkbox existed now fail on 4xx/5xx, because a missing setting is read as on. Turn the checkbox off on steps that relied on the old behaviour.
- **Stop** ends the run at once and marks it **Stopped**.

## Parallel and Join

Wire two or more steps from a **Parallel** step's **branches** output. They all start at once, and each branch follows its own wires.

- Each branch starts with its **own copy** of the flow variables, so branches can't see each other's changes while they run.
- Wire the end of every branch into one **Join**. The Join waits until every branch has finished, then:
  - merges the branches' variables back into the flow. When two branches set the same variable, **the branch that finished last wins**;
  - continues from **passed**, or from **failed** if any branch failed. A branch fails when one of its steps fails with nothing wired to its failed output. That stops only that branch; the others carry on.
- With no Join, the flow ends once every branch has finished, and it is marked Failed if any branch failed.
- Every branch of one Parallel must lead to the same Join. A branch can also simply end (an output with no wire) and still counts as finished.
- Parallels can be nested: a branch can contain its own Parallel and Join.
- In the run, each step inside a branch is marked with its branch number (⑂1, ⑂2, and ⑂1.2 for a branch inside branch 1).

## Loop over CSV

Load a CSV file in the Loop step's settings (it is saved with the flow). The steps wired to **each row** run once per row, one row after another.

- Columns fill `{{column}}` placeholders in those steps' requests, and scripts can read them as `rr.data.column`. A flow variable with the same name wins over a column, the same as in a suite run.
- Flow variables carry from one row to the next, and on to the steps after the loop.
- A row ends when its steps reach an output with no wire, or wire back into the Loop step.
- When every row has run, the flow continues from **done**.
- If a step fails inside the loop with nothing wired to its failed output, that row stops, and the loop goes on with the next row. After the last row, the flow stops and is marked **Failed** because a row failed. The Loop step's notes list which rows failed and why. Wire the failed output if you want a failure inside the loop handled instead.
- A **Run suite** step inside a loop still uses the suite's own CSV; the loop's columns sit underneath it.
- In the run, each step inside a loop shows its row number.

## Retry

Every Run step has a **Retry** setting: try again up to N times, waiting a set time before each new try. The step passes as soon as one try passes, and fails if every try fails. Each try starts from the flow variables as they were when the step began, so a failed try's `rr.vars.set` calls don't leak into the next try. The report lists every try with its time and why it failed.

## Flow variables

Each flow run has one set of **flow variables**, which starts empty.

- A value a script sets with `rr.vars.set()` is visible to every later step, the same way cases share variables inside a suite run. Read it with `{{name}}` or `rr.vars.get("name")`.
- **Set variable** steps write to the same set.
- The selected environment sits underneath: a flow variable with the same name as an environment variable wins.
- Parallel branches and loop rows: see [Parallel and Join](#parallel-and-join) and [Loop over CSV](#loop-over-csv).
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

Open a run from **Flow runs** (or **Open report** after a run) to see:

- **Summary:** passed, failed or stopped, why, how many steps ran, Run steps passed and failed, the total time, the environment, and what started it (the Run button, or which schedule).
- **Run log:** every message from the run, with times.
- **Steps:** one line per step in the order they started, with the Parallel branch or CSV row where it ran. **Failed** shows only the failed steps. Click a step for its notes, tries and variables.
- **Open full report** on a Run step opens its whole test report, with every case, check, request and response. **← Back to the flow run** returns.
- **Show on canvas** shows the flow **as it was when it ran**, read-only, with each step's result. **Back to editing** returns to the flow.
- **Export HTML report** saves one file you can open in any browser: the summary, the run log, every step, and each Run step's full test report inside it. It has a search box and a "failed only" filter, and needs no internet.
- **Export CSV report** saves one line per step, plus one line per case result inside each Run step (the step's columns repeat on those lines, so the file filters well in Excel).
- **Delete run** (in the ⋯ menu) removes the saved run. It does not ask; an **Undo** toast appears for 8 seconds. Exported files are not affected. Reports always mask [secret values](requests.md#secret-values).

## Schedules

A **Schedule** step starts the flow by itself, while REST Runner is open. Add one from the step bar and wire its **next** to the first step, just like Start. A flow can have Start and Schedule steps side by side, and more than one Schedule.

In its settings, pick:

- **Every N minutes**, counted from midnight: every 15 minutes means :00, :15, :30 and :45.
- **Every day** at a time.
- **On chosen days** at a time, for example Monday to Friday at 07:30.

Untick **Run on this schedule** to pause it without deleting it; the step shows **off**. Times are the computer's local time. Scheduled runs use the environment selected in the Flows top bar at the time they start.

- A run that came due **while the app was closed** is skipped. It does not run when you open the app.
- A run that comes due **while the same flow is still running** is skipped.
- A run that comes due while the flow **has an error to fix** (for example a deleted case) is skipped.

Each skip is noted in the Schedule step's settings and under the flow in the list, with the reason. The step's settings also show the next run and the last one. A scheduled run is saved under **Flow runs** like any other, and its report says which schedule started it.

## Export and import

**Export** in the Flows list saves every flow to one JSON file; **Export** above the canvas saves only the open flow. The file also carries the suites and saved requests the flows run, so it works on another computer.

**Import** reads such a file. A flow, suite or saved request with the same id as one you have replaces it; everything else is added. Saved requests go back into a collection and folders with the same names, made if they are missing. The message after the import says how many of each were added and updated. Schedule history is not in the file, so imported schedules start fresh.

## Quick open

Quick open (**Ctrl + K** or **⌘ K**) finds flows and flow runs too. A flow opens on its canvas; a flow run opens its report.
