# Collections, examples and import/export

## Collections and folders

Saved requests live in **collections**. A collection holds requests and **folders**, and folders nest as deep as you like.

Open the tree by clicking the folder area of the **request switcher** in the top bar. The popover has:

- **New**: adds a collection. **Import** and **Export**: see below.
- **+ New request**: opens a blank request in the editor (it is not saved until you save it).
- The tree itself. Click a request to open it.

Right-click a row, or use its **⋯** button, for the actions:

| On | Actions |
| --- | --- |
| A collection or folder | New request, New folder, Rename, Duplicate (folders), Move to… (folders), Delete |
| A request | Add example, Duplicate, Rename, Move to…, Delete |
| An example | Rename, Duplicate, Delete |

Deleting a collection or folder asks first and removes everything inside it. Renaming happens inline. Ids are unique across the whole tree, and a request can only be moved somewhere that makes sense (you cannot move a folder into itself).

If you had requests saved before collections existed, they were moved into a collection called **My requests** the first time you opened the new version.

## Saving

- **Save** (the footer button, or Ctrl/Cmd + S) updates the open request where it already lives. A dot on the button and in the switcher means unsaved changes.
- The first time you save a new request, a dialog asks for a name and where it goes: an existing collection or folder, or a new collection.
- The switcher shows the breadcrumb (Collection › Folder) and an **Example** tag when an example is open. Click the request name, or press F2, to rename it.

## Examples

An example is a named copy of a request's payload (URL, params, headers, body, auth and scripts), like Postman's examples, optionally with the response it got.

- **Save as example** (footer) keeps the current payload as a named example of the open request. The dialog lets you include the last live response as the example's **sample response**.
- Examples are listed under their request in the tree. Opening one loads its payload, and shows its sample response if it has one.
- With an example open, **Set sample response** replaces its sample with the last live response, and Ctrl/Cmd + S saves your edits to the example.
- You can also use **Add example** in a request's menu.

## Export and import

**Export** (in the switcher popover) writes one JSON file with all collections (with folders and examples) and all environments. If any environment variable is marked [secret](requests.md#secret-values), a dialog asks **Include secret values?** and leaves them out by default (the variables stay in the file with empty values). Use it to back up or to move between computers. **Import** reads such a file and merges it:

- A collection or environment with the same id replaces the one you have. Others are added. A secret variable that comes in empty keeps the value you already have.
- Files from the first version of the app (a flat list of saved requests) still import. Requests whose id you already have are updated where they sit, and new ones go into a collection called **Imported requests**.
- Malformed entries are skipped, and a file that is not a REST Runner export is rejected with a message.

The export file contains environment values. Secret values are left out unless you chose to include them; other values, such as non-secret tokens, are always included. Keep the file safe.

Test suites have their own export and import in the [Testing sidebar](testing.md#exporting-suites).
