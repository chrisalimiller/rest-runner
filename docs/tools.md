# Tools

A **tool** is a small lookup page built from your saved requests. You type an ID, press **Look up**, and see the answers from several requests side by side, each block filling in as its request finishes. Typical uses: "Subscriber 360" (profile, account, usage, invoices, plan and devices for one subscriber) or "Order status".

Open it with the **Tools** tab in the status bar along the bottom of the window (`Mod + 4`).

## What a tool is made of

- **Inputs:** the boxes you type into, such as `subscriberId`. An input is a text box or a drop-down, and can have a default that is used when the box is left empty.
- **Calls:** saved requests (or examples) the tool runs. A call has its own name, so the same saved request can appear twice, filled in differently. Calls are not copies: edit the request in Requests and the tool uses the new version.
- **Blocks:** the answers laid out on the page. Block types are **Input**, **Fields** (label and value pairs), **Table**, **Number**, **Status** (a coloured badge), **JSON**, **Note** and **Action** (a button). Up to three blocks share a row.

## Use mode

Use mode is the default when you open a tool.

- **The header** holds the tool's name, its inputs in one row with **Look up** (like the URL bar and Send), and the status beside it. An Input block is not repeated on the Use page (it stays in Build). When a tool is opened, the first input is focused (or **Look up** when there are none), unless you are typing in another field.
- **Look up** (or Enter in an input) sends the tool's lookup calls. Independent calls start together, at most 6 at a time. A call that needs a value from another call starts as soon as that call finishes. Opening a tool does not send anything: it shows its latest saved lookup, marked in an amber band "Saved lookup · 3 h ago · … · Nothing was sent", with **Look up** beside it to refresh (A tool can be set to look up when opened, see [Tool settings](#tool-settings).)
- The status beside Look up counts the calls done. The top right of the header offers **Stop** while running, **Copy all** (each call's request and answer as text) and **Save as HTML**.
- Each data block has a ⋯ menu: **Show raw response**, **Copy**, **Open request** (switches to Requests with the saved request open). The cards do not print the method and URL; hover the time or status in a block's header to see the request that was sent.
- **The environment** is the one chosen in the top bar. Each tool keeps its own choice. Environments are edited in Requests mode. If it is marked with a colour (a production-style environment), **Look up** says **Look up on Prod** and the button gets the environment's outline.

### How a call ends (states)

There is no pass or fail; each block shows how its call ended.

| State | What you see |
| --- | --- |
| Not looked up | A quiet dash. Nothing is sent until you press Look up |
| Waiting | A grey placeholder: the call needs another call to finish first. When it needs a row you have not picked yet: "Waiting for a row in Devices" with **Go to the table** |
| Running | A moving placeholder and "Running" |
| Done, status 2xx | The block's content, with only the time in faint type in its header (`120 ms`) |
| Done, any other status | The status with the time in its header (`404 · 120 ms`), plus for 400 and above the response body and **Retry** / **Open request** |
| No response | The reason (for example "connection refused") and **Retry** |
| Skipped | Why: "Needs accountId from Subscriber" (a value is missing) or "Request missing", which also offers **Choose another request** (opens Build with that block selected) |
| Stopped | "Stopped." |

The button says what it reruns. **Retry** sends just that call again, when no other call reads its answer. **Run lookup again** appears when another call depends on it (or it is a pick-a-row call): the whole lookup runs again, so what depends on it is refreshed too.

### Placeholders and the order calls run

A request's `{{placeholders}}` are filled in this order, for each placeholder:

1. **An input** of the tool, when it has text (otherwise the input's default).
2. **A field of another call's response**, for example `$.account.id` from the Subscriber call.
3. **A fixed value** typed in the tool.
4. Otherwise **the environment**, as in Requests.

If a placeholder is mapped to a field of another call and that field has no value, the call is skipped ("Needs accountId from Subscriber") instead of sending with the environment's value of the same name.

Calls that read from another call run after it; Build mode lists them as Input, Step 1, Step 2 and so on. If calls wait on each other in a loop, **Look up** stays off and the page says which calls; fix it in Build mode.

### Pick a row

When a call's response is a list (for example "the subscriber's devices"), tick **Ask me to pick a row** in Build mode. In Use mode the table block's rows are a radio group: click a row, or move with the arrow keys (Home and End too) and press Enter or Space. The calls that need a field of the chosen row wait until you pick, and say "Waiting for a row in …" with a link that scrolls to the table; calls that do not need it carry on. **Use none** (one button under the table) skips them. The chosen row is highlighted afterwards, and you can choose a different one: only the calls that read from that row run again, and the rest of the page stays as it is. Without a table block for that call, the first row is used.

### Picking in a list (Use mode)

A table block set to one list of a call (a list whose rule is **ask**, or that a value reads with the ask rule) is that list's radio group, the same as for **Ask me to pick a row**: click a row, or move with the arrow keys (Home and End too) and press Enter or Space. A call can have several such lists and they are asked at once, each in its own table. A value that reads the list shows "Waiting for a row in Devices" with **Go to the table** (the list's name, not the call's) until you pick; calls that read a different list carry on. **Use none** under a table skips what reads that list. A list of one item is picked for you, and a list with no table block uses its first item.

After the lookup you can click another row in a list's table: only the calls that read that list (or a list inside it) run again, and the rest of the page stays as it is. A different row in a list that holds other lists (the services that hold features) clears the picks inside it, so you pick those again. Picking again does not change the saved lookup.

Looking up again with the same inputs keeps your picks: if a row with the same label (the list's label path) comes back, it is picked again without asking. With other inputs, or when the row is gone, you are asked again.

A table on a list with more than 50 rows has a **Filter rows** box above it; filtering does not change which row is picked. A table on an empty list says "No devices".

Recent lookups remember the picks: opening one marks the picked row in each table. **Copy all** adds a line under each call that has them (`Picked Devices: iPhone 15; Services: Mobile`), and **Save as HTML** marks the picked row in each list's table.

### Lists inside a response (engine)

A response can hold several lists at once, such as a customer's `services` and `devices`. A call can name each of them (a **list**: its path, a label for its items, and a rule for which item it hands on) and a value can say which item it reads. Build mode does not set this up yet; the engine and the file format come first, and tools saved before this keep working exactly as they were.

A list's rule, or the rule of one value that reads it, is one of:

- **none**: the list is only shown.
- **ask**: the row picked in the table. A list of one item is picked without asking, unless the list turns that off.
- **index**: `0` is the first item, `-1` the last, `n` the item at that position.
- **where**: the first item whose field equals (or does not equal) a value. The value is mapped like a placeholder: an input, another call's field, or fixed text. A call that supplies it runs first.
- On a value only: **all** (every item's field, joined, optionally only items that match) and **count** (how many items).

A list can sit inside another list (the features of a service): its path is read from the parent's chosen item.

A call with lists finishes as soon as its response is in. Only the calls that read a list wait for its pick, and a call that reads one list does not wait for the pick in another. When an item cannot be chosen the call is skipped with the reason: "Customer has no devices", "No service where status = active in Customer", "No row picked in Devices", "Devices is not a list in this response".

Fields and mappings with no list keep reading the whole response, as before. A call with **Ask me to pick a row** keeps working as it did; a call has either that or lists.

**Export files.** A tools file that uses lists is written as `version: 2`; a file without them stays `version: 1`. This version refuses a file with a newer version ("This file needs a newer REST Runner"). Earlier versions ignore `version` and would drop the list fields on import, so update before importing a file that uses lists.

### Action buttons and the production confirm

An **Action** block is a button that runs a **write** call (a POST, PUT, PATCH or DELETE request) with the values on screen: inputs and the answers of the last lookup. Write calls never run in Look up, only from their button. After pressing it, the block shows the status and response body, or the error.

- On an environment **marked with a colour** (a production-style one) the button reads "… on Prod", and pressing it opens a confirm dialog that names the environment and shows the request's method and URL. The confirm button is outlined in the environment's colour. **Cancel** is focused. If you cancel, nothing is sent and the block says **Not confirmed**.
- The block can also have **Confirm text** (set in Build mode, in the block's last step). When it has, the dialog asks on any environment and shows that text.
- The button is off while a lookup runs or while it is sending, and it needs the values its request uses: if a lookup has not filled them in, the block says what is missing ("Needs id from Subscriber").
- An action's result stays until the next lookup starts.

### Save as HTML

**Save as HTML** (next to **Copy all**) saves the answers on screen as one self-contained web page to send to someone: the blocks in their rows, with the date, environment and inputs. It uses the same look as the HTML reports from batch runs, Testing and Flows, follows the reader's light or dark setting, and prints. Everything shown is escaped, and known secret values are masked the same way as in history and reports. Action buttons are left out of the page.

### Variables panel

The **{x}** Variables panel in Tools shows the tool's environment and the placeholders that the tool leaves to it. A tool's inputs are listed apart, as **Tool inputs**: they are typed on the page, not kept in an environment. Placeholders filled from an input, another call or a fixed value are not asked for.

## Build mode

Switch with **Build** next to the tool name. Build edits a draft; nothing is kept until **Save**. Leaving with unsaved changes (switching tools, section or closing the window) asks to **Save**, **Discard** or keep editing.

- **Calls column (left):** the calls grouped as Input, Step 1, Step 2…, with what each call needs and gives. **Add request** opens a panel beside the column with a search box (name, folder or URL) and your saved requests and examples. Click one, or move with the arrow keys and press Enter, to add it; the panel stays open so you can add more, and shows how many times each request is already used. You can also drag a request from the panel into the Calls column. Esc closes it. Each call shows its name, its method and URL, and what it needs (tagged `input`, `step 1`, `env` or `fixed`; a value with nowhere to come from shows in red). Under **Options** on each call are a **Write call** checkbox (on by default for POST, PUT, PATCH and DELETE requests) and **Ask me to pick a row** for lists; Options opens by itself when either differs from its default.
- **Block page (right):** rows of up to three blocks. Type `/` in the bar at the bottom ("Type / to add a block") and pick a block type from the list. Each block always shows its handle and **Connect…**; its **⋯** menu (visible on hover, focus or selection) holds Move left/right/up/down, Duplicate and Delete. Move a block by dragging its handle, from that menu, or with **Alt + arrow keys** while the block is focused; **Connect** opens the dialog that asks which request fills the block, which value fills each placeholder, which fields to show, and the label and format (text, number, money, date, yes/no). Steps move with **Back** and **Next**; **Done** appears on the last step, and once the block is valid **Save and close** is offered on earlier steps. The connected request's method and URL show once, in the step bar.
- **Run with sample** runs the lookup with the sample values typed in Build, so every block fills with a real answer and **Connect** can offer values to click. Sample runs are never saved to history, and write calls are not sent by Look up or Run with sample. Action buttons in Build can be pressed too; they use the sample answers and the same production confirm.
- **Settings** (button in the Build header): see below.

### Tool settings

- **About:** name and description.
- **Inputs:** name, label, kind (text or drop-down with its choices) and default.
- **Lookups:** the environment, **Look up when the tool is opened**, and **Keep recent lookups**.

## History and privacy

Each tool keeps its **last 20 lookups**, listed under **Recent lookups** on the left. Click one to see its answers (below 1100px wide, where the sidebar becomes a row at the top, open them from its **Recent** menu, which also has the switch and Clear history) and the inputs it was made with; nothing is sent. Lookups are stored on your computer in the same database as saved test and flow runs. Response bodies are cut at 1 MB and secret environment values are masked with the same rules as other saved runs; the request is stored without its headers, so credentials do not end up in history.

- **Clear history** removes all of the open tool's saved lookups. A toast says "Removed N saved lookups" with **Undo**; the lookups are deleted for good when it goes away.
- **Keep recent lookups** off is the keep-nothing switch (the sidebar says "Off: lookups aren't kept" under it): the tool stores no lookups, and the ones it has are removed once the Undo toast goes away. **Undo** restores them and turns the switch back on. The answers on screen are still there until you leave the tool.
- Deleting a tool removes its lookups when the Undo toast goes away.

## Export and import

- **Export** (in the Tools sidebar for all tools, or **Export tool** in the tool's ⋯ menu) writes a `.json` file with the saved tools **and the saved requests they use**, together with the collection and folder they sat in. Unsaved Build changes are not in the file.
- **Import** reads such a file. A tool or saved request with the same id **replaces** the one you have; everything else is added, and requests go back into a collection and folder with the same names (made if missing). A toast stays up for a minute (or until dismissed) and says what changed, such as "Added 2 tools and 5 requests; updated 1 tool (Billing)"; replaced tools are named when there are three or fewer. Import is a button in the Tools, Flows and Testing sidebars, so the keyboard reaches it. Unsaved Build edits of a tool that was replaced are discarded, since they were made against the old version. Imports are checked, and anything that cannot be read as a tool is skipped.
- **Export workspace…** includes tools, and importing a workspace file in the Import dialog lists its tools, and you choose which to bring in and what to do when a name already exists. Older workspace files without tools leave your tools alone.

## Used by tools

In Requests, a saved request that tools use shows **Used by 2 tools** at the top of its context menu (hover for the names). Deleting a request, folder or collection that tools use asks first and names those tools; if you delete anyway, their calls show "Request missing" until you pick another request in Build mode.

## Quick open and the status bar

- **Quick open** (`Mod + K`) lists your tools; picking one switches to Tools and opens it. **New tool** is a command (type `>new tool`).
- The Tools tab on the status bar shows an accent dot while a lookup runs (and the activity slot says "Tools running"), and `✕` when a lookup that finished while you were in another section had calls that ended with an error status or no response, until you open Tools.
