# Quick open, commands and keyboard shortcuts

## Quick open

Press **Ctrl + K** (Windows) or **⌘ K** (Mac), or click the search box in the top bar, to jump to anything you have saved. Press the shortcut again, or Esc, to close it. It works in every mode.

It searches these groups in one list:

| Group | Opens |
| --- | --- |
| **Requests** | The request in the Requests editor |
| **Examples** | The example (and its sample response) |
| **History** | An earlier send, with its response, as a sample. A **Clear history** button sits in this group's header |
| **Batch runs** | The run in the [run explorer](batch-runs.md#the-run-explorer) |
| **Suites** | The suite in Testing |
| **Test cases** | The case, inside its suite |
| **Test runs** | The report in Testing |
| **Flows** | The flow on its canvas |
| **Flow runs** | The [flow run report](flows.md#reports) |
| **Tools** | The tool, in Use mode ([Tools](tools.md)) |

The group for the mode you are in comes first. A **Commands** group comes last, or first when no request, run or other item has your text in its title. Pasting a whole curl command into the box opens Import from cURL with it filled in. See [Paste a cURL command](curl-import.md).

## Commands

Quick open is also a command palette. Type `>` first (as in VS Code) to see only commands; `>` alone lists all of them, `>dark` narrows them. Without the `>`, commands show up when your text is in a command's name or starts one of its keywords (two letters or more), and with nothing typed the first few are listed under the requests. The key for a command, where it has one, is shown at the right of its row. Commands that do not apply (Send request while you are in Testing, Go to the section you are already in) are hidden.

| Command | What it does |
| --- | --- |
| **Go to Requests / Testing / Flows / Tools** | Switch section |
| **New tool** | Switch to Tools and add a tool (opens in Build mode) |
| **Send request** | Send the open request (Requests only; says so if the URL is empty) |
| **Run with CSV…** | Open the batch pane of the open request, where you pick the file |
| **New request** | Open a new Untitled tab (Requests only) |
| **New collection** | Add a collection and start renaming it |
| **Import…** | Open the Import dialog (Postman, Insomnia, Bruno, .env, REST Runner files) |
| **Import from cURL…** | Open the cURL import dialog |
| **Export workspace…** | Export collections, environments, suites, flows and tools to one file |
| **Switch environment…** | Types `>Environment: ` so the choices (None and each environment) are listed; Enter on one makes it active. **Current** marks the active one. You can also type `>env staging` |
| **Toggle Variables panel** | Open or close the Variables side panel |
| **Open Certificates** | Open the Certificates side panel |
| **Appearance: System / Light / Dark** | Set the appearance (also in Settings, under General) |
| **Keyboard shortcuts** | Open the list of shortcuts (also `?`) |
| **Settings and about…** | Open settings, keyboard shortcuts and update information |

- The search is fuzzy: the letters you type must appear in order (`gtu` finds "Get users"), and runs of letters, word starts and matches in the title score higher. It also looks at the method, folder path or URL, and the detail text.
- With nothing typed, you see the most recent items of each group. Each group shows its best six matches.
- **↑ / ↓** move through the list, **Enter** opens the highlighted item or runs the highlighted command, **Esc** closes.

## Keyboard shortcuts

`Mod` means Ctrl on Windows and ⌘ on Mac. The same list is in the app: press `?` when no text field has focus, or run **Keyboard shortcuts** from the palette.

| Shortcut | What it does |
| --- | --- |
| `Mod + K` | Open or close Quick open and the command palette |
| `?` | Show the keyboard shortcuts (when no text field or editor has focus and no dialog is open) |
| `Mod + 1` / `2` / `3` / `4` | Switch to Requests, Testing, Flows or Tools, the four section tabs at the left of the status bar (works from inside text fields and editors too) |
| `Mod + Enter` | Send the request (Requests mode; also works from inside the body and script editors) |
| `Enter` in the URL box | Send the request |
| `Mod + S` | Save the open request or example |
| `F2` | Rename the open request |
| `Shift + Alt + F` | Format the JSON body (in the body editor) |
| `Mod + Z` | Undo, including undoing the automatic format after pasting JSON. In Flows, outside text fields, it undoes the last canvas edit; `Mod + Shift + Z` redoes it |
| `Tab` | Indent in the JSON and script editors |
| `Space`, `↑ / ↓`, `Space` on a case's numbered circle | Pick up, move and drop a test case ([reordering](testing.md#reordering-cases)); `Esc` cancels |
| `Ctrl + Space` | Show autocomplete in a script editor (it also appears when you type `rr.`) |
| `←` / `→` on the column divider | Move the divider (2% steps). Double-click the divider to reset it |
| `←` `→` `↑` `↓`, `Home`, `End` on the environment switch | Choose another environment |
| `↑` / `↓` in the run explorer | Previous or next call |
| `Esc` | Close Quick open, menus and dialogs |

### Tabs

These work in Requests mode only, also from inside text fields and editors. They use the physical key, so they work on any keyboard layout.

| Shortcut | What it does |
| --- | --- |
| `Mod + T` | New tab (an Untitled request) |
| `Mod + W` | Close the active tab. On a pinned tab it only says to unpin it first |
| `Mod + Shift + T` | Reopen the last closed tab |
| `Ctrl + Tab` / `Ctrl + Shift + Tab` | Next or previous tab, in the order the bar shows them (Ctrl on a Mac too, as in browsers) |
| `Mod + Alt + 1` to `9` | Go to tab 1 to 8; `9` goes to the last tab |
| `←` / `→`, `Home`, `End` on the tab bar | Move between tabs |
| `Enter` / `Space`, `Delete` on a tab | Open it, close it |
| `Mod + Enter` in Quick open | Open the request in a tab of its own instead of the preview tab |

On a Mac the app's menu bar has no Close Window item, so `⌘ W` closes a tab. The red window button and `⌘ Q` still close the window and quit.

The Requests shortcuts (`Mod + Enter`, `Mod + S`, `F2`) are switched off while Testing is on screen, while Quick open, the environment editor or a dialog is open, and while a run is open in the run explorer.
