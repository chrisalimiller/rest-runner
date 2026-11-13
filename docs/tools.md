# Tools

A **tool** is a small lookup page built from your saved requests. You type an ID, press **Look up**, and see the answers from several requests side by side, each block filling in as its request finishes. Typical uses: "Subscriber 360" (profile, account, usage, invoices, plan and devices for one subscriber) or "Order status".

Open it with the **Tools** tab in the status bar along the bottom of the window (`Mod + 4`).

## What a tool is made of

- **Inputs:** the boxes you type into, such as `subscriberId`. An input is a text box or a drop-down, and can have a default that is used when the box is left empty.
- **Calls:** saved requests (or examples) the tool runs. A call has its own name, so the same saved request can appear twice, filled in differently. Calls are not copies: edit the request in Requests and the tool uses the new version.
- **Blocks:** the answers laid out on the page. Block types are **Input**, **Fields** (label and value pairs), **Table**, **Number**, **Status** (a coloured badge), **JSON**, **Note** and **Action** (a button). Up to three blocks share a row.

## Use mode

Use mode is the default when you open a tool.

- **Look up** (or Enter in an input) sends the tool's lookup calls. Independent calls start together, at most 6 at a time. A call that needs a value from another call starts as soon as that call finishes. Opening a tool does not send anything: it shows its latest saved lookup, marked "Saved lookup from … Nothing was sent." (A tool can be set to look up when opened, see [Tool settings](#tool-settings).)
- The line above the blocks counts the calls done, offers **Stop** while running, **Copy all** (each call's request and answer as text) and **Save as HTML**.
- Each data block has a ⋯ menu: **Show raw response**, **Copy**, **Open request** (switches to Requests with the saved request open).
- **The environment** is the one chosen in the top bar. Each tool keeps its own choice. Environments are edited in Requests mode. If it is marked with a colour (a production-style environment), **Look up** says **Look up on Prod** and the button gets the environment's outline.

### How a call ends (states)

There is no pass or fail; each block shows how its call ended.

| State | What you see |
| --- | --- |
| Not looked up | "Look up to fill this in." |
| Waiting | A grey placeholder: the call needs another call to finish first |
| Running | A moving placeholder and "Running" |
| Done, status below 400 | The block's content, with the status and time in its header (`200 · 120 ms`) |
| Done, status 400 or above | The status, the response body and **Retry** / **Open request** |
| No response | The reason (for example "connection refused") and **Retry** |
| Skipped | Why: "Needs accountId from Subscriber" (a value is missing) or "Request missing" |
| Stopped | "Stopped." |

**Retry** sends just that call again when no other call reads its answer. When another call depends on it (or it is a pick-a-row call), Retry runs the whole lookup again, so what depends on it is refreshed too. The button's hover text says which.

### Placeholders and the order calls run

A request's `{{placeholders}}` are filled in this order, for each placeholder:

1. **An input** of the tool, when it has text (otherwise the input's default).
2. **A field of another call's response**, for example `$.account.id` from the Subscriber call.
3. **A fixed value** typed in the tool.
4. Otherwise **the environment**, as in Requests.

If a placeholder is mapped to a field of another call and that field has no value, the call is skipped ("Needs accountId from Subscriber") instead of sending with the environment's value of the same name.

Calls that read from another call run after it; Build mode lists them as Input, Step 1, Step 2 and so on. If calls wait on each other in a loop, **Look up** stays off and the page says which calls; fix it in Build mode.

### Pick a row

When a call's response is a list (for example "the subscriber's devices"), tick **Ask me to pick a row** in Build mode. In Use mode the table block shows **Use this row** next to each row, and the calls that need a field of the chosen row wait until you pick; calls that do not need it carry on. **Use none** skips them. The chosen row is highlighted afterwards. Without a table block for that call, the first row is used.

### Action buttons and the production confirm

An **Action** block is a button that runs a **write** call (a POST, PUT, PATCH or DELETE request) with the values on screen: inputs and the answers of the last lookup. Write calls never run in Look up, only from their button. After pressing it, the block shows the status and response body, or the error.

- On an environment **marked with a colour** (a production-style one) the button reads "… on Prod", and pressing it opens a confirm dialog that names the environment and the request. **Cancel** is focused. If you cancel, nothing is sent and the block says **Not confirmed**.
- The block can also have **Confirm text** (set in Build mode, in the block's last step). When it has, the dialog asks on any environment and shows that text.
- The button is off while a lookup runs or while it is sending, and it needs the values its request uses: if a lookup has not filled them in, the block says what is missing ("Needs id from Subscriber").
- An action's result stays until the next lookup starts.

### Save as HTML

**Save as HTML** (next to **Copy all**) saves the answers on screen as one self-contained web page to send to someone: the blocks in their rows, with the date, environment and inputs. It uses the same look as the HTML reports from batch runs, Testing and Flows, follows the reader's light or dark setting, and prints. Everything shown is escaped, and known secret values are masked the same way as in history and reports. Action buttons are left out of the page.

### Variables panel

The **{x}** Variables panel in Tools shows the tool's environment and the placeholders that the tool leaves to it. A tool's inputs are listed apart, as **Tool inputs**: they are typed on the page, not kept in an environment. Placeholders filled from an input, another call or a fixed value are not asked for.

## Build mode

Switch with **Build** next to the tool name. Build edits a draft; nothing is kept until **Save**. Leaving with unsaved changes (switching tools, section or closing the window) asks to **Save**, **Discard** or keep editing.

- **Calls column (left):** the calls grouped as Input, Step 1, Step 2…, with what each call needs and gives. **Add request** opens a panel beside the column with a search box (name, folder or URL) and your saved requests and examples. Click one, or move with the arrow keys and press Enter, to add it; the panel stays open so you can add more, and shows how many times each request is already used. You can also drag a request from the panel into the Calls column. Esc closes it. Each call has a name, a **Write call** checkbox (on by default for POST, PUT, PATCH and DELETE requests) and **Ask me to pick a row** for lists.
- **Block page (right):** rows of up to three blocks. Type `/` in the bar at the bottom ("Type / to add a block") and pick a block type from the list. Move a block by its handle or the arrow buttons; **Connect** opens the dialog that asks which request fills the block, which value fills each placeholder, which fields to show, and the label and format (text, number, money, date, yes/no).
- **Run with sample** runs the lookup with the sample values typed in Build, so every block fills with a real answer and **Connect** can offer values to click. Sample runs are never saved to history, and write calls are not sent by Look up or Run with sample. Action buttons in Build can be pressed too; they use the sample answers and the same production confirm.
- **Settings** (button in the Build header): see below.

### Tool settings

- **About:** name and description.
- **Inputs:** name, label, kind (text or drop-down with its choices) and default.
- **Lookups:** the environment, **Look up when the tool is opened**, and **Keep recent lookups**.

## History and privacy

Each tool keeps its **last 20 lookups**, listed under **Recent lookups** on the left. Click one to see its answers and the inputs it was made with; nothing is sent. Lookups are stored on your computer in the same database as saved test and flow runs. Response bodies are cut at 1 MB and secret environment values are masked with the same rules as other saved runs; the request is stored without its headers, so credentials do not end up in history.

- **Clear history** removes all of the open tool's saved lookups.
- **Keep recent lookups** off is the keep-nothing switch: the tool stores no lookups, and the ones it has are removed. The answers on screen are still there until you leave the tool.
- Deleting a tool removes its lookups when the Undo toast goes away.

## Export and import

- **Export** (in the Tools sidebar for all tools, or **Export tool** in the tool's ⋯ menu) writes a `.json` file with the saved tools **and the saved requests they use**, together with the collection and folder they sat in. Unsaved Build changes are not in the file.
- **Import** reads such a file. A tool or saved request with the same id **replaces** the one you have; everything else is added, and requests go back into a collection and folder with the same names (made if missing). The notice says how many tools and requests were added or updated. Unsaved Build edits of a tool that was replaced are discarded, since they were made against the old version. Imports are checked, and anything that cannot be read as a tool is skipped.
- **Export workspace…** includes tools, and importing a workspace file in the Import dialog lists its tools, and you choose which to bring in and what to do when a name already exists. Older workspace files without tools leave your tools alone.

## Used by tools

In Requests, a saved request that tools use shows **Used by 2 tools** at the top of its context menu (hover for the names). Deleting a request, folder or collection that tools use asks first and names those tools; if you delete anyway, their calls show "Request missing" until you pick another request in Build mode.

## Quick open and the status bar

- **Quick open** (`Mod + K`) lists your tools; picking one switches to Tools and opens it. **New tool** is a command (type `>new tool`).
- The Tools tab on the status bar shows an accent dot while a lookup runs (and the activity slot says "Tools running"), and `✕` when a lookup that finished while you were in another section had calls that ended with an error status or no response, until you open Tools.
