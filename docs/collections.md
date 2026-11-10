# Collections, examples and import/export

REST Runner supports GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS. REST Runner files containing unsupported request methods are rejected; Postman imports skip unsupported requests and report a warning.

## Collections and folders

Saved requests live in **collections**. A collection holds requests and **folders**, and folders nest as deep as you like.

Open the tree by clicking the folder area of the **request switcher** in the top bar. The popover has:

- **New**: adds a collection. **Import…** opens the [Import dialog](#the-import-dialog); **Export workspace…**: see below.
- **+ New request**: opens a blank request in the editor (it is not saved until you save it).
- **From cURL…**: makes a request from a pasted curl command, and can save it straight into a folder. See [Paste a cURL command](curl-import.md).
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

- **Save** (in the ⋯ menu next to Send, or Ctrl/Cmd + S) updates the open request where it already lives. A dot on the menu item and in the switcher means unsaved changes.
- The first time you save a new request, a dialog asks for a name and where it goes: an existing collection or folder, or a new collection.
- The switcher shows the breadcrumb (Collection › Folder) and an **Example** tag when an example is open. Click the request name, or press F2, to rename it.

## Examples

An example is a named copy of a request's payload (URL, params, headers, body, auth and scripts), like Postman's examples, optionally with the response it got.

- **Save as example** (⋯ menu) keeps the current payload as a named example of the open request. The dialog lets you include the last live response as the example's **sample response**.
- Examples are listed under their request in the tree. Opening one loads its payload, and shows its sample response if it has one.
- With an example open, **Set sample response** replaces its sample with the last live response, and Ctrl/Cmd + S saves your edits to the example.
- You can also use **Add example** in a request's menu.

## Export and import

**Export workspace…** (in the switcher popover) writes one JSON file, the *workspace file*, with all collections (with folders and examples), all environments, all test suites (with their CSV data) and all flows. It is the file to hand to a teammate or to back up with. If any environment variable is marked [secret](requests.md#secret-values), a dialog asks **Include secret values?** and leaves them out by default (the variables stay in the file with empty values).

Everything comes back in through one **Import** dialog, described next.

### The Import dialog

The same dialog opens from **Import…** in the collections sidebar (the switcher popover), from **Import…** in the environment manager, and from **Import…** in Quick open (Ctrl/Cmd + K). There is no format picker: each file is recognised on its own.

1. **Add files.** Drop several files at once, choose them with **Choose files…**, or use **Paste text…** for JSON or the contents of a `.env` file. Supported:
   - Postman collections (v2.0 and v2.1), environments and globals
   - Insomnia exports (export as *Insomnia v4 (JSON)*; the newer YAML format is not read)
   - Bruno collections (the JSON file from *Export collection*) and Bruno environment files (`.bru`)
   - `.env` files (`KEY=VALUE`, `export`, quotes and comments are understood; a file called `.env.staging` suggests the name "staging")
   - REST Runner workspace files (all versions), and the separate test suites and flows files
2. **Review.** The dialog lists what it found, with a checkbox on each item. **Nothing is created unless it is checked.** Collections and environments from a file of their own start checked. Variables found *inside* a collection (offered as an environment) and Postman globals are listed but start unchecked. Test suites, flows and certificate rules from a REST Runner file are listed too.
3. **Per item:** you can rename it. An environment can be flagged **Production environment** (you decide; it is never guessed from the name) and has **Mark secret-looking values**, on by default: variables named like `token`, `key`, `secret` or `password` become [secret values](requests.md#secret-values). Postman variables of type *secret* are always secret.
4. **Name clashes.** If an item's name (ignoring case) matches one you already have, or another item in the same import, the dialog asks what to do, with nothing preselected: **Merge** (add what is new and update what matches: variables of an environment by name, folders and requests of a collection), **Replace** (swap the existing one for the imported one; the existing one keeps its id, and a production flag you already set stays on) or **Keep both** (the imported one is added under a new name such as "Dev (2)"). Test suites and flows offer Replace and Keep both. **Import stays disabled until every clash is answered**; **Apply to all** sets one answer for all of them.
5. **Result.** A summary lists what was added, merged and replaced, with warnings (skipped scripts, unsupported auth and so on). **Undo import** puts the collections, environments, suites, flows and certificate rules back as they were before the import.

The import is worked out on a copy first and written only when it is complete, so a problem leaves your data untouched. Imported flow schedules are off. A secret variable that arrives blank keeps the value you already have when you Merge or Replace.

### Format notes

**Postman**

- **Collections (v2.0 and v2.1):** folders keep their nesting. Each request keeps its method, URL, query parameters, headers and body, and rows that are unticked in Postman come in disabled. Saved responses become **examples** with a sample response. `{{variable}}` placeholders work as they are.
- **Auth:** Bearer, Basic and API key carry over. Auth set on a collection or folder is copied to every request below it that does not set its own, and "No Auth" is respected. Other types (OAuth 2, Digest and so on) come in as no auth, with a warning.
- **Bodies:** raw JSON becomes a JSON body, other raw text a text body, x-www-form-urlencoded stays as is, and GraphQL becomes a JSON body with `query` and `variables`. Form-data is sent as an url-encoded form (file fields are dropped), and file bodies are dropped, each with a warning.
- **Variables:** collection and folder variables are offered as an environment called "Collection name variables", unchecked. Importing a collection never creates an environment by itself. `:id` path variables are filled in with the value stored in Postman.
- **Environments and globals:** each file is one environment. Disabled variables stay disabled. Secret variables are marked secret; Postman may have exported their values empty.
- **Scripts and methods:** Postman scripts (`pm.*`) are copied but do not run here until converted, and requests with a method other than GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS are skipped, each with a warning.

**Insomnia:** each workspace becomes a collection (folders and order kept) and each non-empty environment an environment, with nested values flattened to `a.b`. `{{ _.name }}` becomes `{{name}}`. JSON, text and url-encoded bodies and Bearer, Basic and API key auth carry over. Other auth, multipart files, gRPC and WebSocket requests, and template tags such as `now` or `uuid` are reported as warnings.

**Bruno:** folders, requests, headers, query params, JSON, text, XML, GraphQL and url-encoded bodies, Bearer, Basic and API key auth, and the collection's environments come across. Scripts and tests are skipped with a warning (Bruno's `bru` API differs from the [`rr` API](scripting.md)). Bruno does not store secret values in environment files, so secret variables arrive empty.

**REST Runner files:** a workspace file of any version, a test suites file or a flows file. A flat list of saved requests from the first version of the app imports as a collection.

The export file contains environment values. Secret values are left out unless you chose to include them; other values, such as non-secret tokens, are always included. Keep the file safe.

Test suites and flows also keep their own **Export** and **Import** in the [Testing sidebar](testing.md#exporting-suites) and the Flows sidebar.

### First run

On a fresh install (nothing saved yet) a welcome screen offers three ways to start: **Import a shared workspace** (pick a workspace file from a teammate), **Open the sample workspace** (a few requests, a test suite with CSV data and a flow against the public `postman-echo.com` echo API, plus a *Sample* environment that is selected for you), or **Start empty**. It shows once; after you choose, or as soon as you have saved anything, it does not come back.

Imported flow schedules are off, including on replacement. Review the flow and selected environment before enabling them in Flows. When a workspace certificate matches a local fingerprint, existing local rules are kept; review and edit host patterns, enabled state and CA trust under Certificates.
