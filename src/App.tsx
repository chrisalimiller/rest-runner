import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthEditor } from "./components/AuthEditor";
import { BatchPane } from "./components/BatchPane";
import { BodyEditor } from "./components/BodyEditor";
import { ExampleDialog, MoveDialog, SaveRequestDialog, type DestinationChoice } from "./components/CollectionDialogs";
import { CollectionTree, type TreeAction } from "./components/CollectionTree";
import { EnvironmentEditor } from "./components/EnvironmentEditor";
import { countActive, KeyValueEditor } from "./components/KeyValueEditor";
import { ResponsePane } from "./components/ResponsePane";
import { RunExplorer } from "./components/RunExplorer";
import { Sidebar } from "./components/Sidebar";
import {
  addExample,
  canMove,
  cleanCollections,
  duplicate,
  insertAt,
  isRequestDef,
  locate,
  migrateSavedRequests,
  move,
  newCollection,
  newFolder,
  remove,
  rename,
  requestNode,
  sampleFromResponse,
  setExampleResponse,
  updateExample,
  updateRequest,
  type Collection,
  type Destination,
  type RequestExample,
  type SampleResponse,
} from "./lib/collections";
import { newRequest } from "./lib/defaults";
import { environmentVars, type Environment } from "./lib/environments";
import { sendRequest } from "./lib/http";
import { newId } from "./lib/ids";
import { prepareRequest } from "./lib/request";
import type { RunSummary } from "./lib/run";
import { deleteRun, listRuns } from "./lib/runStore";
import { saveTextFile } from "./lib/saveFile";
import { importWorkspaceFile, toWorkspaceFile } from "./lib/workspace";
import { load, save } from "./lib/storage";
import { HTTP_METHODS, type HistoryEntry, type HttpMethod, type RequestDef, type SendOutcome } from "./lib/types";

type RequestTab = "params" | "auth" | "headers" | "body";
type LowerPane = "response" | "batch";

const DRAFT_KEY = "rest-runner.draft";
const HISTORY_KEY = "rest-runner.history";
const MAX_HISTORY = 50;
/** Old flat list of saved requests; read once to migrate into collections. */
const SAVED_KEY = "rest-runner.saved";
const COLLECTIONS_KEY = "rest-runner.collections";
const EXPANDED_KEY = "rest-runner.expanded";
const ENVIRONMENTS_KEY = "rest-runner.environments";
const ACTIVE_ENV_KEY = "rest-runner.active-environment";

function loadCollections(): Collection[] {
  const stored = load<unknown>(COLLECTIONS_KEY, null);
  if (stored !== null) return cleanCollections(stored);
  return migrateSavedRequests(load<unknown[]>(SAVED_KEY, []).filter(isRequestDef));
}

type Dialog =
  | { type: "save"; dest: Destination | null }
  | { type: "move"; id: string; name: string }
  | { type: "example"; requestId: string; requestName: string; exampleName: string; base: RequestDef; response: SampleResponse | null; responseLabel: string | null };

function sampleOutcome(example: RequestExample, response: SampleResponse, envVars: Record<string, string>): SendOutcome {
  return {
    ok: true,
    request: prepareRequest(example.request, envVars),
    response: { ...response, sizeBytes: new TextEncoder().encode(response.body).length, durationMs: 0 },
    sentAt: "",
  };
}

/** `active` is false while another section (Testing) is on screen, so keyboard shortcuts stay out of its way. */
export default function App({ active = true }: { active?: boolean }) {
  const [def, setDef] = useState<RequestDef>(() => load(DRAFT_KEY, newRequest()));
  const [tab, setTab] = useState<RequestTab>("params");
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [sending, setSending] = useState(false);
  const [pane, setPane] = useState<LowerPane>("response");
  const [batchRunning, setBatchRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => load(HISTORY_KEY, []));
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>(loadCollections);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(load<string[] | null>(EXPANDED_KEY, null) ?? collections.map((c) => c.id)),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [outcomeIsSample, setOutcomeIsSample] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>(() => load(ENVIRONMENTS_KEY, []));
  const [activeEnvId, setActiveEnvId] = useState<string | null>(() => load(ACTIVE_ENV_KEY, null));
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;
  const envVars = useMemo(() => environmentVars(activeEnv), [activeEnv]);
  const located = useMemo(() => locate(collections, def.id), [collections, def.id]);
  const savedVersion = located?.kind === "request" ? located.node.request : located?.kind === "example" ? located.example.request : undefined;
  const isDirty = !savedVersion || JSON.stringify(savedVersion) !== JSON.stringify(def);
  const crumbs =
    located?.kind === "request" || located?.kind === "example"
      ? [located.collection.name, ...located.path.map((f) => f.name), ...(located.kind === "example" ? [located.node.request.name] : [])]
      : [];

  useEffect(() => {
    save(COLLECTIONS_KEY, collections);
  }, [collections]);
  useEffect(() => {
    save(EXPANDED_KEY, [...expanded]);
  }, [expanded]);
  useEffect(() => {
    save(ENVIRONMENTS_KEY, environments);
  }, [environments]);
  useEffect(() => {
    save(ACTIVE_ENV_KEY, activeEnvId);
  }, [activeEnvId]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const refreshRuns = useCallback(() => {
    listRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);
  useEffect(refreshRuns, [refreshRuns]);

  useEffect(() => {
    save(DRAFT_KEY, def);
  }, [def]);
  useEffect(() => {
    save(HISTORY_KEY, history);
  }, [history]);

  const patch = (p: Partial<RequestDef>) => setDef((d) => ({ ...d, ...p }));

  const send = useCallback(async () => {
    if (sending || def.url.trim() === "") return;
    setPane("response");
    const prepared = prepareRequest(def, envVars);
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    const result = await sendRequest(prepared, controller.signal);
    abortRef.current = null;
    setSending(false);
    setOutcome(result);
    setOutcomeIsSample(false);
    setHistory((h) =>
      [
        {
          id: newId(),
          method: prepared.method,
          url: prepared.url,
          status: result.ok ? result.response.status : null,
          sentAt: result.sentAt,
          def: structuredClone(def),
        },
        ...h,
      ].slice(0, MAX_HISTORY),
    );
  }, [def, sending, envVars]);

  const cancel = () => abortRef.current?.abort();

  const saveCurrent = useCallback(() => {
    const copy = structuredClone(def);
    if (located?.kind === "request") {
      setCollections((c) => updateRequest(c, copy));
      setNotice(`Saved "${copy.name}".`);
    } else if (located?.kind === "example") {
      setCollections((c) => updateExample(c, copy));
      setNotice(`Saved example "${copy.name}".`);
    } else {
      setDialog({ type: "save", dest: null });
    }
  }, [def, located]);

  const expand = (...ids: (string | null | undefined)[]) =>
    setExpanded((set) => {
      const next = new Set(set);
      for (const id of ids) if (id) next.add(id);
      return next;
    });

  const toggle = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openDef = (d: RequestDef) => {
    setDef(structuredClone(d));
    setOutcome(null);
    setOutcomeIsSample(false);
    setOpenRun(null);
  };

  const openExample = (ex: RequestExample) => {
    openDef(ex.request);
    if (ex.response) {
      setOutcome(sampleOutcome(ex, ex.response, envVars));
      setOutcomeIsSample(true);
      setPane("response");
    }
  };

  /** Resolves a destination choice, creating a new collection if asked. */
  const resolveDest = (cols: Collection[], choice: DestinationChoice): { cols: Collection[]; dest: Destination } => {
    if ("dest" in choice) return { cols, dest: choice.dest };
    const c = newCollection(choice.newCollection);
    return { cols: [...cols, c], dest: { collectionId: c.id, folderId: null } };
  };

  const liveResponse = outcome?.ok && !outcomeIsSample ? outcome.response : null;

  const startExample = (requestId: string) => {
    const found = locate(collections, requestId);
    if (found?.kind !== "request") return;
    const fromEditor = def.id === requestId || (located?.kind === "example" && located.node.id === requestId);
    const base = fromEditor ? def : found.node.request;
    const res = fromEditor ? liveResponse : null;
    setDialog({
      type: "example",
      requestId,
      requestName: found.node.request.name,
      exampleName: `Example ${found.node.examples.length + 1}`,
      base,
      response: res ? sampleFromResponse(res) : null,
      responseLabel: res ? `${res.status} ${res.statusText}`.trim() : null,
    });
  };

  const onTreeAction = (a: TreeAction) => {
    switch (a.type) {
      case "new-request": {
        const r = newRequest();
        setCollections((c) => insertAt(c, a.dest, [requestNode(r)]));
        expand(a.dest.collectionId, a.dest.folderId);
        openDef(r);
        setRenamingId(r.id);
        break;
      }
      case "new-folder": {
        const f = newFolder("New folder");
        setCollections((c) => insertAt(c, a.dest, [f]));
        expand(a.dest.collectionId, a.dest.folderId);
        setRenamingId(f.id);
        break;
      }
      case "add-example":
        startExample(a.requestId);
        break;
      case "rename":
        setCollections((c) => rename(c, a.id, a.name));
        if (def.id === a.id) setDef((d) => ({ ...d, name: a.name }));
        break;
      case "duplicate": {
        const r = duplicate(collections, a.id);
        setCollections(r.collections);
        break;
      }
      case "move": {
        const found = locate(collections, a.id);
        const name = found?.kind === "folder" ? found.folder.name : found?.kind === "request" ? found.node.request.name : "";
        setDialog({ type: "move", id: a.id, name });
        break;
      }
      case "delete":
        if (window.confirm(`Delete ${a.label}?`)) setCollections((c) => remove(c, a.id));
        break;
    }
  };

  const addCollection = () => {
    const c = newCollection("New collection");
    setCollections((list) => [...list, c]);
    expand(c.id);
    setRenamingId(c.id);
  };

  const exportWorkspace = async () => {
    try {
      const result = await saveTextFile("rest-runner-export.json", toWorkspaceFile(collections, environments), "REST Runner export", "json");
      if (result.saved) setNotice(result.path ? `Exported to ${result.path}` : "Export downloaded.");
    } catch (e) {
      setNotice(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importWorkspace = async (file: File) => {
    try {
      const result = importWorkspaceFile(await file.text(), collections, environments);
      setCollections(result.collections);
      expand(...result.collections.filter((c) => !collections.some((x) => x.id === c.id)).map((c) => c.id));
      setEnvironments(result.environments);
      setNotice(`Imported ${file.name}: ${result.added} added, ${result.replaced} updated.`);
    } catch (e) {
      setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || openRun !== null || showEnvEditor || dialog !== null) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void send();
      }
      if (e.key.toLowerCase() === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send, saveCurrent, openRun, showEnvEditor, dialog, active]);

  const methodAllowsBody = def.method !== "GET" && def.method !== "HEAD";
  const tabLabel = (name: string, count: number) => (count > 0 ? `${name} (${count})` : name);

  return (
    <div className="app">
      <Sidebar
        collections={
          <CollectionTree
            collections={collections}
            activeId={openRun === null ? def.id : null}
            expanded={expanded}
            onToggle={toggle}
            renamingId={renamingId}
            onRenamingChange={setRenamingId}
            onOpenRequest={(node) => openDef(node.request)}
            onOpenExample={(_node, ex) => openExample(ex)}
            onAction={onTreeAction}
          />
        }
        hasCollections={collections.length > 0}
        onNewCollection={addCollection}
        onExport={() => void exportWorkspace()}
        onImport={(f) => void importWorkspace(f)}
        history={history}
        runs={runs}
        activeRunId={openRun}
        onOpenRun={setOpenRun}
        onNew={() => openDef(newRequest())}
        onOpen={(h) => openDef(h.def)}
        onClear={() => setHistory([])}
      />

      {openRun !== null && (
        <main className="workspace">
          <RunExplorer
            runId={openRun}
            onBack={() => setOpenRun(null)}
            onDelete={(id) => {
              void deleteRun(id).finally(refreshRuns);
              setOpenRun(null);
            }}
          />
        </main>
      )}

      <main className="workspace" hidden={openRun !== null}>
        <div className="workspace-head">
          {crumbs.length > 0 && (
            <span className="crumbs small" title={crumbs.join(" / ")}>
              {crumbs.map((c, i) => (
                <span key={i}>
                  {c}
                  <span className="crumb-sep">/</span>
                </span>
              ))}
            </span>
          )}
          {located?.kind === "example" && <span className="chip example-chip">Example</span>}
          <input
            className="request-name"
            value={def.name}
            onChange={(e) => patch({ name: e.target.value })}
            aria-label="Request name"
          />
          <span className="muted small save-state">{savedVersion ? (isDirty ? "Unsaved changes" : "Saved") : "Not saved"}</span>
          {(located?.kind === "request" || located?.kind === "example") && (
            <button className="link-btn small" onClick={() => startExample(located.node.id)} title="Keep the current payload as a named example of this request">
              Save as example
            </button>
          )}
          {located?.kind === "example" && liveResponse && (
            <button
              className="link-btn small"
              title="Keep the last response as this example's sample response"
              onClick={() => {
                setCollections((c) => setExampleResponse(c, def.id, sampleFromResponse(liveResponse)));
                setNotice("Saved the response as the sample.");
              }}
            >
              Set sample response
            </button>
          )}
          {notice && <span className="small notice">{notice}</span>}
          <span className="env-picker">
            <select value={activeEnvId ?? ""} onChange={(e) => setActiveEnvId(e.target.value || null)} aria-label="Environment">
              <option value="">No environment</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name || "(unnamed)"}
                </option>
              ))}
            </select>
            <button className="secondary" onClick={() => setShowEnvEditor(true)} title="Add or edit environments">
              Environments
            </button>
          </span>
        </div>

        <div className="request-bar">
          <select
            className={`method-select m-${def.method.toLowerCase()}`}
            value={def.method}
            onChange={(e) => patch({ method: e.target.value as HttpMethod })}
            aria-label="Method"
          >
            {HTTP_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            className="url-input"
            value={def.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="Enter URL, e.g. https://api.example.com/users"
            spellCheck={false}
            aria-label="URL"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) void send();
            }}
          />
          {sending ? (
            <button className="send cancel" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button className="send" onClick={() => void send()} disabled={def.url.trim() === ""} title="Send (Ctrl/Cmd + Enter)">
              Send
            </button>
          )}
          <button className="secondary save-btn" onClick={saveCurrent} title="Save (Ctrl/Cmd + S)">
            Save{savedVersion && isDirty ? " •" : ""}
          </button>
        </div>

        <section className={`request-config ${pane === "batch" ? "compact" : ""}`}>
          <div className="tabs">
            <button className={tab === "params" ? "active" : ""} onClick={() => setTab("params")}>
              {tabLabel("Params", countActive(def.params))}
            </button>
            <button className={tab === "auth" ? "active" : ""} onClick={() => setTab("auth")}>
              Authorization{def.auth.type !== "none" ? " •" : ""}
            </button>
            <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
              {tabLabel("Headers", countActive(def.headers))}
            </button>
            <button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>
              Body{def.bodyMode !== "none" ? " •" : ""}
            </button>
          </div>
          <div className="tab-panel">
            {tab === "params" && (
              <>
                <p className="muted small">Query parameters are added to the end of the URL when the request is sent.</p>
                <KeyValueEditor rows={def.params} onChange={(params) => patch({ params })} />
              </>
            )}
            {tab === "auth" && <AuthEditor auth={def.auth} onChange={(auth) => patch({ auth })} />}
            {tab === "headers" && <KeyValueEditor rows={def.headers} onChange={(headers) => patch({ headers })} />}
            {tab === "body" && (
              <BodyEditor
                mode={def.bodyMode}
                body={def.body}
                formBody={def.formBody}
                methodAllowsBody={methodAllowsBody}
                onModeChange={(bodyMode) => patch({ bodyMode })}
                onBodyChange={(body) => patch({ body })}
                onFormChange={(formBody) => patch({ formBody })}
              />
            )}
          </div>
        </section>

        <section className="lower">
          <div className="pane-switch tabs">
            <button className={pane === "response" ? "active" : ""} onClick={() => setPane("response")}>
              Response
            </button>
            <button className={pane === "batch" ? "active" : ""} onClick={() => setPane("batch")}>
              Batch run (CSV){batchRunning ? " ●" : ""}
            </button>
          </div>
          <div className="lower-body" hidden={pane !== "response"}>
            <ResponsePane outcome={outcome} sending={sending} isSample={outcomeIsSample} />
          </div>
          <div className="lower-body" hidden={pane !== "batch"}>
            <BatchPane
              def={def}
              envVars={envVars}
              envName={activeEnv?.name}
              onRunningChange={setBatchRunning}
              onRunSaved={refreshRuns}
              onOpenRun={setOpenRun}
            />
          </div>
        </section>
      </main>
      {dialog?.type === "save" && (
        <SaveRequestDialog
          collections={collections}
          initialName={def.name}
          initialDest={dialog.dest}
          onClose={() => setDialog(null)}
          onSave={(name, choice) => {
            const { cols, dest } = resolveDest(collections, choice);
            const copy = { ...structuredClone(def), name };
            setCollections(insertAt(cols, dest, [requestNode(copy)]));
            setDef(copy);
            expand(dest.collectionId, dest.folderId);
            setDialog(null);
            setNotice(`Saved "${name}".`);
          }}
        />
      )}
      {dialog?.type === "move" && (
        <MoveDialog
          collections={collections}
          itemName={dialog.name}
          allow={(d) => canMove(collections, dialog.id, d)}
          onClose={() => setDialog(null)}
          onMove={(choice) => {
            const { cols, dest } = resolveDest(collections, choice);
            setCollections(move(cols, dialog.id, dest));
            expand(dest.collectionId, dest.folderId);
            setDialog(null);
          }}
        />
      )}
      {dialog?.type === "example" && (
        <ExampleDialog
          requestName={dialog.requestName}
          initialName={dialog.exampleName}
          responseLabel={dialog.responseLabel}
          onClose={() => setDialog(null)}
          onSave={(name, includeResponse) => {
            const r = addExample(collections, dialog.requestId, name, dialog.base, includeResponse && dialog.response ? dialog.response : undefined);
            setCollections(r.collections);
            expand(dialog.requestId);
            setDef(structuredClone(r.example.request));
            setOpenRun(null);
            // With a sample kept, the response on screen is that sample; otherwise clear it.
            if (!includeResponse) setOutcome(null);
            setOutcomeIsSample(false);
            setDialog(null);
            setNotice(`Saved example "${name}".`);
          }}
        />
      )}
      {showEnvEditor && (
        <EnvironmentEditor
          environments={environments}
          activeId={activeEnvId}
          onChange={(envs) => {
            setEnvironments(envs);
            if (activeEnvId && !envs.some((e) => e.id === activeEnvId)) setActiveEnvId(null);
          }}
          onClose={() => setShowEnvEditor(false)}
        />
      )}
    </div>
  );
}
