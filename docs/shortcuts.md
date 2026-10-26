# Quick open and keyboard shortcuts

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

The group for the mode you are in comes first.

- The search is fuzzy: the letters you type must appear in order (`gtu` finds "Get users"), and runs of letters, word starts and matches in the title score higher. It also looks at the method, folder path or URL, and the detail text.
- With nothing typed, you see the most recent items of each group. Each group shows its best six matches.
- **↑ / ↓** move through the list, **Enter** opens the highlighted item, **Esc** closes.

## Keyboard shortcuts

`Mod` means Ctrl on Windows and ⌘ on Mac.

| Shortcut | What it does |
| --- | --- |
| `Mod + K` | Open or close Quick open |
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

The Requests shortcuts (`Mod + Enter`, `Mod + S`, `F2`) are switched off while Testing is on screen, while Quick open, the environment editor or a dialog is open, and while a run is open in the run explorer.
