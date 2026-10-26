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

**Export workspace…** (in the switcher popover) writes one JSON file, the *workspace file*, with all collections (with folders and examples), all environments, all test suites (with their CSV data) and all flows. It is the file to hand to a teammate or to back up with. If any environment variable is marked [secret](requests.md#secret-values), a dialog asks **Include secret values?** and leaves them out by default (the variables stay in the file with empty values). **Import** reads a workspace file and merges it, and the notice afterwards says how many collections, environments, suites and flows were added or updated:

- A collection, environment, suite or flow with the same id replaces the one you have. Others are added. A secret variable that comes in empty keeps the value you already have.
- Files from the first version of the app (a flat list of saved requests) still import. Requests whose id you already have are updated where they sit, and new ones go into a collection called **Imported requests**.
- **Postman files** also import with the same button: a collection export (v2.0 or v2.1) or an environment or globals export. See below.
- Malformed entries are skipped, and a file that is not a REST Runner export is rejected with a message.

### Importing from Postman

Export from Postman (**Export** on a collection, or on an environment), then use **Import** here.

- **Collections (v2.0 and v2.1):** folders keep their nesting. Each request keeps its method, URL, query parameters, headers and body, and rows that are unticked in Postman come in disabled. Saved responses become **examples** with a sample response. `{{variable}}` placeholders work as they are.
- **Auth:** Bearer, Basic and API key carry over. Auth set on a collection or folder is copied to every request below it that does not set its own, and "No Auth" is respected. Other types (OAuth 2, Digest and so on) come in as no auth, with a warning.
- **Bodies:** raw JSON becomes a JSON body, other raw text a text body, x-www-form-urlencoded stays as is, and GraphQL becomes a JSON body with `query` and `variables`. Form-data is sent as an url-encoded form (file fields are dropped), and file bodies are dropped, each with a warning.
- **Variables:** collection and folder variables become an environment called "Collection name variables". `:id` path variables are filled in with the value stored in Postman.
- **Environments and globals:** each file becomes one environment. Disabled variables stay disabled. Secret variables are imported as plain values, which Postman may have exported empty.
- **Not imported:** Postman scripts (`pm.*`), which do not run here, and requests with a method other than GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS.
- Importing the same file again replaces what it added earlier instead of duplicating it. The message after the import lists any warnings.

The export file contains environment values. Secret values are left out unless you chose to include them; other values, such as non-secret tokens, are always included. Keep the file safe.

Older files still import: workspace files from before suites and flows were included (version 2), the first version's flat list of saved requests, and the separate test suites and flows files. Test suites and flows also keep their own **Export** and **Import** in the [Testing sidebar](testing.md#exporting-suites) and the Flows sidebar.

### First run

On a fresh install (nothing saved yet) a welcome screen offers three ways to start: **Import a shared workspace** (pick a workspace file from a teammate), **Open the sample workspace** (a few requests, a test suite with CSV data and a flow against the public `postman-echo.com` echo API, plus a *Sample* environment that is selected for you), or **Start empty**. It shows once; after you choose, or as soon as you have saved anything, it does not come back.
