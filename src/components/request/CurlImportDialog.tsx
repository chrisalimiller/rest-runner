import { useEffect, useMemo, useState } from "react";
import type { CertificateEntry } from "../../lib/certificates";
import { detectDialect, parseCurl, type CurlCommand, type CurlDialect, type CurlParse } from "../../lib/curlImport";
import { matchVariables, type VarSwap } from "../../lib/curlVariables";
import { type Collection, type Destination } from "../../lib/collections";
import type { Environment } from "../../lib/environments";
import { currentMasker } from "../../lib/secrets";
import type { KeyValue, RequestDef } from "../../lib/types";
import { destKey, DestinationPicker, NEW_COLLECTION, parseKey, type DestinationChoice } from "../CollectionDialogs";
import { Modal } from "../shell/Modal";
import { WithPlaceholders } from "./RequestEditor";
import "./curlImport.css";

/** What the person chose in the dialog. App turns it into tabs and saved requests. */
export interface CurlImportChoice {
  /** The commands to create, with any name changes applied. */
  commands: CurlCommand[];
  useVars: boolean;
  /** One command: a new tab or the current tab, and whether to also save it. */
  openIn: "new" | "active";
  save: DestinationChoice | null;
  /** Several commands: separate new tabs, or saved in a collection (inside a new folder when `folderName` is not empty). */
  place: "tabs" | "collection";
  destination: DestinationChoice;
  folderName: string;
}

interface Props {
  initialText: string;
  initialOpenIn: "new" | "active";
  /** Pre-selects Save to; `saveTicked` also ticks it. */
  initialDest: Destination | null;
  saveTicked: boolean;
  collections: Collection[];
  environment: Environment | null;
  certificates: readonly CertificateEntry[];
  onCreate: (choice: CurlImportChoice) => void;
  onClose: () => void;
}

type ReadAs = "auto" | CurlDialect;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short" });
/** `Pasted 29 Oct`, in the local date. */
export function defaultFolderName(now = new Date()): string {
  return `Pasted ${now.getDate()} ${MONTH_FORMAT.format(now)}`;
}

function rowsText(rows: KeyValue[], sep: string, mask: (s: string) => string): string[] {
  return rows.filter((r) => r.key !== "").map((r) => mask(`${r.key}${sep}${r.value}`));
}

function bodyText(def: RequestDef): React.ReactNode {
  if (def.bodyMode === "none") return <span className="muted">None</span>;
  if (def.bodyMode === "urlencoded") return `Form · ${def.formBody.filter((r) => r.key !== "").length} fields`;
  if (def.bodyMode === "text") return `Text · ${def.body.length} characters`;
  let valid = true;
  try {
    JSON.parse(def.body.replace(/\{\{[^}]*\}\}/g, '"x"'));
  } catch {
    valid = false;
  }
  return (
    <>
      Raw JSON · <span className={valid ? "curl-ok" : "curl-bad"}>{valid ? "valid" : "not valid JSON"}</span>
    </>
  );
}

function Preview({ def, command, name, onName, mask }: { def: RequestDef; command: CurlCommand; name: string; onName: (n: string) => void; mask: (s: string) => string }) {
  const params = rowsText(def.params, " = ", mask);
  const headers = rowsText(def.headers, ": ", mask);
  const auth = def.auth;
  return (
    <>
      <label className="curl-name">
        <span className="muted">Name</span>
        <input value={name} onChange={(e) => onName(e.target.value)} aria-label="Request name" />
      </label>
      <div className="curl-url mono">
        <span className={`method m-${def.method.toLowerCase()}`}>{def.method}</span>
        <span className="curl-url-text">
          <WithPlaceholders text={mask(def.url)} />
        </span>
      </div>
      <dl className="curl-facts">
        <dt>Params</dt>
        <dd className="mono">{params.length ? params.map((p) => <div key={p}>{p}</div>) : <span className="muted">None</span>}</dd>
        <dt>Auth</dt>
        <dd>
          {auth.type === "bearer" && <>Bearer · <span className="mono">{mask(auth.token) || "(empty)"}</span></>}
          {auth.type === "basic" && <>Basic · <span className="mono">{mask(auth.username)}</span> / ••••••</>}
          {auth.type === "none" && <span className="muted">None</span>}
          {auth.type === "apikey" && <>API key</>}
        </dd>
        <dt>Headers</dt>
        <dd className="mono">{headers.length ? headers.map((h) => <div key={h}>{h}</div>) : <span className="muted">None</span>}</dd>
        <dt>Body</dt>
        <dd>{bodyText(def)}</dd>
      </dl>
      <CommandNotes command={command} />
    </>
  );
}

function CommandNotes({ command }: { command: CurlCommand }) {
  if (command.notes.length === 0) return null;
  return (
    <ul className="curl-notes">
      {command.notes.map((n, i) => (
        <li key={i}>
          <span className={`curl-mark ${n.level === "warn" ? "warn" : "muted"}`}>{n.level === "warn" ? "!" : "·"}</span> {n.text}
        </li>
      ))}
    </ul>
  );
}

function errorFor(parsed: CurlParse, text: string): { title: string; body: string } | null {
  if (parsed.ok) return null;
  if (parsed.line !== undefined) return { title: "Can't read the command", body: parsed.error };
  const first = text.trim().split(/\s+/, 1)[0] ?? "";
  const fetchLike = /^(fetch|await|Invoke-WebRequest|Invoke-RestMethod|\$)/i.test(first);
  return {
    title: "Not a curl command",
    body: `This doesn't start with curl.${fetchLike ? ' In DevTools use Copy › Copy as cURL (bash or cmd), not "Copy as fetch" or "Copy as PowerShell".' : ""}`,
  };
}

/** Import from cURL: paste text, see the request it makes, then open it, replace the current tab, or save it. Several commands show a list. */
export function CurlImportDialog({ initialText, initialOpenIn, initialDest, saveTicked, collections, environment, certificates, onCreate, onClose }: Props) {
  const [text, setText] = useState(initialText);
  const [readAs, setReadAs] = useState<ReadAs>("auto");
  const [useVars, setUseVars] = useState(true);
  const [openIn, setOpenIn] = useState<"new" | "active">(initialOpenIn);
  const [place, setPlace] = useState<"tabs" | "collection">("collection");
  const [save, setSave] = useState(saveTicked);
  const firstDest = initialDest ?? (collections[0] ? { collectionId: collections[0].id, folderId: null } : null);
  const [target, setTarget] = useState(firstDest ? destKey(firstDest) : NEW_COLLECTION);
  const [newCollection, setNewCollection] = useState(collections.length === 0 ? "My requests" : "");
  const [folderName, setFolderName] = useState(defaultFolderName);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});

  const debounced = useDebounced(text, 150);
  const detected = useMemo(() => detectDialect(debounced), [debounced]);
  const parsed = useMemo<CurlParse | null>(
    () => (debounced.trim() === "" ? null : parseCurl(debounced, { dialect: readAs === "auto" ? undefined : readAs, certificates })),
    [debounced, readAs, certificates],
  );
  useEffect(() => {
    setNames({});
    setSkipped({});
  }, [parsed]);

  const entries = parsed?.ok ? parsed.commands : [];
  const mask = useMemo(() => currentMasker(), [parsed]);
  const env = environment;
  const swapsFor = (c: CurlCommand) => (env ? matchVariables(c.def, env.vars) : { def: c.def, swaps: [] as VarSwap[] });
  const okCommands = entries.map((e, i) => ({ e, i })).filter((x): x is { e: CurlCommand; i: number } => x.e.ok);
  const multi = entries.length > 1;
  const showList = multi && !editing;
  const anySwaps = okCommands.some(({ e }) => swapsFor(e).swaps.length > 0);
  const chosen = okCommands.filter(({ i }) => !skipped[i]);
  const error = errorFor(parsed ?? { ok: true, dialect: "bash", commands: [], skipped: [] }, text);
  const singleFail = parsed?.ok && entries.length === 1 && !entries[0].ok ? (entries[0] as { error: string }).error : null;

  const destChoice = (): DestinationChoice => (target === NEW_COLLECTION ? { newCollection: newCollection.trim() } : { dest: parseKey(target) });
  const destValid = target !== NEW_COLLECTION || newCollection.trim() !== "";
  const saveActive = multi ? place === "collection" : save && openIn === "new";
  const canCreate = chosen.length > 0 && (!saveActive || destValid);

  const submit = () => {
    if (!canCreate) return;
    onCreate({
      commands: chosen.map(({ e, i }) => (names[i] === undefined ? e : { ...e, def: { ...e.def, name: names[i].trim() || e.def.name } })),
      useVars: useVars && anySwaps,
      openIn,
      save: !multi && save && openIn === "new" ? destChoice() : null,
      place: multi ? place : "tabs",
      destination: destChoice(),
      folderName: folderName.trim(),
    });
  };

  const single = okCommands.length === 1 && !multi ? okCommands[0] : null;
  const singleView = single ? swapsFor(single.e) : null;
  const singleDef = single && singleView ? (useVars ? singleView.def : single.e.def) : null;
  const dialectLabel = detected === "cmd" ? "cmd" : "Bash";
  const envName = env?.name || "the selected environment";

  const varsBox =
    anySwaps && env ? (
      <div className="curl-vars">
        <label className="check-row">
          <input type="checkbox" checked={useVars} onChange={(e) => setUseVars(e.target.checked)} /> <strong>Use {envName} variables where the values match</strong>
        </label>
        {useVars && (
          <ul className="curl-swaps mono">
            {[...new Map(okCommands.flatMap(({ e }) => swapsFor(e).swaps).map((s) => [s.name, s])).values()].map((s) => (
              <li key={s.name}>
                <span className="muted curl-swap-from">{s.secret ? "••••••" : mask(s.value)}</span> <span className="muted">→</span> <span className="curl-var">{`{{${s.name}}}`}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="muted small">Only whole values or a URL's start are matched. Untick to keep everything literal.</div>
      </div>
    ) : null;

  const footer = (
    <div className="curl-foot">
      {multi ? (
        <>
          <span className="muted">Put them</span>
          <div className="segmented" role="group" aria-label="Put them">
            <button className={place === "tabs" ? "on" : ""} onClick={() => setPlace("tabs")}>
              In {chosen.length} new tab{chosen.length === 1 ? "" : "s"}
            </button>
            <button className={place === "collection" ? "on" : ""} onClick={() => setPlace("collection")}>
              In a collection
            </button>
          </div>
          {place === "collection" && (
            <>
              <DestinationPicker compact collections={collections} value={target} onChange={setTarget} newName={newCollection} onNewNameChange={setNewCollection} />
              <span className="muted">folder</span>
              <input value={folderName} onChange={(e) => setFolderName(e.target.value)} aria-label="New folder name" className="curl-folder" placeholder="(none)" />
            </>
          )}
        </>
      ) : (
        <>
          <span className="muted">Open in</span>
          <div className="segmented" role="group" aria-label="Open in">
            <button className={openIn === "new" ? "on" : ""} onClick={() => setOpenIn("new")}>
              New tab
            </button>
            <button className={openIn === "active" ? "on" : ""} onClick={() => setOpenIn("active")}>
              This tab
            </button>
          </div>
          <span className="muted">and</span>
          <label className="check-row" title={openIn === "active" ? "Pick New tab to also save the request" : undefined}>
            <input type="checkbox" checked={save && openIn === "new"} disabled={openIn === "active"} onChange={(e) => setSave(e.target.checked)} /> Save to
          </label>
          <DestinationPicker compact disabled={!save || openIn === "active"} collections={collections} value={target} onChange={setTarget} newName={newCollection} onNewNameChange={setNewCollection} />
        </>
      )}
      <span className="curl-foot-gap" />
      <span className="curl-foot-actions">
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="send" onClick={submit} disabled={!canCreate}>
          {multi ? `Create ${chosen.length} request${chosen.length === 1 ? "" : "s"}` : "Create request"}
        </button>
      </span>
    </div>
  );

  return (
    <Modal label="Import from cURL" onClose={onClose} className="curl-modal">
      <div className="modal-head">
        <h3>Import from cURL</h3>
        {multi ? <span className="curl-count">{entries.length} commands found</span> : <span className="muted small">Paste one or more curl commands. Bash and Windows cmd styles both work.</span>}
        <span className="curl-foot-gap" />
        {multi && (
          <button className="secondary" onClick={() => setEditing((e) => !e)}>
            {editing ? "Show list" : "Edit text"}
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {showList ? (
        <div className="curl-body curl-multi">
          <span className="curl-label">Each command becomes one request</span>
          <table className="curl-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={okCommands.length > 0 && chosen.length === okCommands.length}
                    onChange={(e) => setSkipped(Object.fromEntries(okCommands.map(({ i }) => [i, !e.target.checked])))}
                  />
                </th>
                <th>Method</th>
                <th>URL</th>
                <th>Name</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) =>
                e.ok ? (
                  <tr key={i}>
                    <td>
                      <input type="checkbox" aria-label={`Include ${i + 1}`} checked={!skipped[i]} onChange={(ev) => setSkipped((s) => ({ ...s, [i]: !ev.target.checked }))} />
                    </td>
                    <td className={`mono method m-${e.def.method.toLowerCase()}`}>{e.def.method}</td>
                    <td className="mono curl-cell-url" title={e.def.url}>
                      <WithPlaceholders text={mask((useVars ? swapsFor(e).def : e.def).url)} />
                    </td>
                    <td>
                      <input value={names[i] ?? e.def.name} onChange={(ev) => setNames((n) => ({ ...n, [i]: ev.target.value }))} aria-label={`Name ${i + 1}`} />
                    </td>
                    <td className={e.notes.some((n) => n.level === "warn") ? "curl-note-count" : "muted"}>
                      {e.notes.filter((n) => n.level === "warn").length > 0 ? `${e.notes.filter((n) => n.level === "warn").length} note${e.notes.filter((n) => n.level === "warn").length === 1 ? "" : "s"}` : "–"}
                    </td>
                  </tr>
                ) : (
                  <tr key={i} className="curl-row-bad">
                    <td />
                    <td colSpan={4} className="curl-bad">
                      Line {e.line}: {e.error}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <div className="curl-multi-lower">
            <div className="curl-card">
              {okCommands.some(({ e }) => e.notes.some((n) => n.level === "warn")) ? (
                okCommands
                  .filter(({ e }) => e.notes.some((n) => n.level === "warn"))
                  .map(({ e, i }) => (
                    <div key={i}>
                      <strong>{names[i] ?? e.def.name} · notes</strong>
                      <CommandNotes command={{ ...e, notes: e.notes.filter((n) => n.level === "warn") }} />
                    </div>
                  ))
              ) : (
                <span className="muted">No notes.</span>
              )}
            </div>
            {varsBox && <div className="curl-card">{varsBox}</div>}
          </div>
          {parsed?.ok && parsed.skipped.length > 0 && (
            <div className="muted small">
              Skipped lines between the commands: <span className="mono">{parsed.skipped.join("  ·  ")}</span>
            </div>
          )}
          <div className="muted small">
            Commands are split where a new line starts with <span className="mono">curl</span>. Shell lines between them (like <span className="mono">export TOKEN=…</span> or comments) are skipped.
          </div>
        </div>
      ) : (
        <div className="curl-body curl-split">
          <div className="curl-pane">
            <div className="curl-pane-head">
              <span className="curl-label">Command</span>
              <span className="curl-foot-gap" />
              <span className="muted small">Read as</span>
              <div className="segmented" role="group" aria-label="Read as">
                <button className={readAs === "auto" ? "on" : ""} onClick={() => setReadAs("auto")}>
                  Auto · {dialectLabel}
                </button>
                <button className={readAs === "bash" ? "on" : ""} onClick={() => setReadAs("bash")}>
                  Bash
                </button>
                <button className={readAs === "cmd" ? "on" : ""} onClick={() => setReadAs("cmd")}>
                  cmd
                </button>
              </div>
            </div>
            <textarea
              className={`curl-text mono ${error ? "bad" : ""}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="cURL command"
              spellCheck={false}
              autoFocus
              placeholder={"curl 'https://api.example.com/v1/items' \\\n  -H 'Accept: application/json'"}
            />
            <div className="muted small">Tip: in Chrome or Edge DevTools, right-click a request and choose Copy › Copy as cURL.</div>
          </div>
          <div className="curl-pane curl-preview">
            {error ? (
              <div className="curl-error" role="alert">
                <strong>{error.title}</strong>
                <span>{error.body}</span>
              </div>
            ) : singleFail ? (
              <div className="curl-error" role="alert">
                <strong>Can't use this command</strong>
                <span>{singleFail}</span>
              </div>
            ) : single && singleDef ? (
              <>
                <span className="curl-label">Preview: the request that will be created</span>
                <Preview def={singleDef} command={single.e} name={names[single.i] ?? single.e.def.name} onName={(n) => setNames({ [single.i]: n })} mask={mask} />
                {varsBox}
              </>
            ) : multi ? (
              <div className="muted">
                {entries.length} commands found. <button className="link-btn" onClick={() => setEditing(false)}>Show list</button>
              </div>
            ) : (
              <div className="muted">The request this command makes shows here.</div>
            )}
          </div>
        </div>
      )}
      {footer}
    </Modal>
  );
}
