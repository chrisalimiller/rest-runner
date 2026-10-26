import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BatchPane } from "./components/BatchPane";
import { ExampleDialog, ExportWorkspaceDialog, MoveDialog, SaveRequestDialog, type DestinationChoice } from "./components/CollectionDialogs";
import { CollectionTree, type TreeAction } from "./components/CollectionTree";
import { EnvironmentEditor } from "./components/EnvironmentEditor";
import { RequestEditor } from "./components/request/RequestEditor";
import { RequestSwitcher } from "./components/request/RequestSwitcher";
import { ResponsePane } from "./components/ResponsePane";
import { RunExplorer } from "./components/RunExplorer";
import { TopBar } from "./components/shell/TopBar";
import { useToast } from "./components/shell/Toast";
import { useDeferredDelete } from "./components/shell/useDeferredDelete";
import { VariablesPopover } from "./components/shell/VariablesPopover";
import type { ShellCommand, ShellProps } from "./Root";
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
  removeWithRestore,
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
import { emptyRow, newRequest } from "./lib/defaults";
import { earlierSendLabel, earlierSends, earlierSendTone, sendTooltip, whenLabel } from "./lib/earlierSends";
import { fitHistory, historyLabel, historyOutcome, MAX_HISTORY_BODY, responseNotKept } from "./lib/history";
import { environmentVars, guardFor, loadEnvironments, newEnvironment, type Environment } from "./lib/environments";
import { sendRequest } from "./lib/http";
import { newId } from "./lib/ids";
import { prepareRequest, unresolvedPlaceholders } from "./lib/request";
import { secretValues } from "./lib/secrets";
import { requestVariableRows, type VariableRow } from "./lib/variables";
import { hasScripts, requestScriptRunner, sendWithScripts } from "./lib/requestScripts";
import type { Vars } from "./lib/template";
import type { ScriptOutput } from "./lib/testing/types";
import type { RunSummary } from "./lib/run";
import type { QuickItem } from "./lib/quickOpen";
import { deleteRun, listRuns } from "./lib/runStore";
import { saveTextFile } from "./lib/saveFile";
import { describeWorkspaceImport, importWorkspace as mergeWorkspace, toWorkspaceFile } from "./lib/workspace";
import { readWorkspace, writeWorkspace } from "./lib/workspaceStore";
import { load, save } from "./lib/storage";
import type { HistoryEntry, RequestDef, SendOutcome } from "./lib/types";

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
const SECTIONS_KEY = "rest-runner.request-sections";
const SPLIT_KEY = "rest-runner.split";
/** Variables set by request scripts (rr.vars.set), kept between sends. */
const SCRIPT_VARS_KEY = "rest-runner.script-vars";
const MIN_COLUMN = 380;

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

interface Props {
  /** False while Testing (or quick open) is on screen, so keyboard shortcuts stay out of its way. */
  active?: boolean;
  shell: ShellProps;
  command: ShellCommand | null;
}

export default function App({ active = true, shell, command }: Props) {
  const [def, setDef] = useState<RequestDef>(() => load(DRAFT_KEY, newRequest()));
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [scriptRun, setScriptRun] = useState<{ pre?: ScriptOutput; post?: ScriptOutput } | null>(null);
  const [scriptVars, setScriptVars] = useState<Vars>(() => load<Vars>(SCRIPT_VARS_KEY, {}));
  const [sending, setSending] = useState(false);
  const [pane, setPane] = useState<LowerPane>("response");
  const [batchVisited, setBatchVisited] = useState(false);
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
  const [sampleLabel, setSampleLabel] = useState<string | undefined>(undefined);
  const [shownHistoryId, setShownHistoryId] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>(loadEnvironments);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(() => load(ACTIVE_ENV_KEY, null));
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [focusVarId, setFocusVarId] = useState<string | undefined>(undefined);
  const [showVariables, setShowVariables] = useState(false);
  const [exportDialog, setExportDialog] = useState(false);
  const toast = useToast();
  const [notice, setNotice] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const [split, setSplit] = useState<number>(() => {
    const v = load<number>(SPLIT_KEY, 0.55);
    return typeof v === "number" && v > 0.1 && v < 0.9 ? v : 0.55;
  });
  const abortRef = useRef<AbortController | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;
  const envVars = useMemo(() => environmentVars(activeEnv), [activeEnv]);
  /** What placeholders resolve against: environment, then variables scripts have set. */
  const sendVars = useMemo(() => ({ ...envVars, ...scriptVars }), [envVars, scriptVars]);
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
    save(SPLIT_KEY, split);
  }, [split]);
  useEffect(() => {
    save(SCRIPT_VARS_KEY, scriptVars);
  }, [scriptVars]);
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
  const runDelete = useDeferredDelete(deleteRun, refreshRuns);

  useEffect(() => {
    save(DRAFT_KEY, def);
  }, [def]);
  useEffect(() => {
    // Responses make history larger; if storage is full, drop the oldest responses until it fits.
    fitHistory(history, (h) => save(HISTORY_KEY, h));
  }, [history]);

  const patch = (p: Partial<RequestDef>) => setDef((d) => ({ ...d, ...p }));

  const send = useCallback(async () => {
    if (sending || def.url.trim() === "") return;
    setPane("response");
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    const scripted = await sendWithScripts({
      def,
      env: envVars,
      data: {},
      vars: scriptVars,
      iteration: 0,
      send: sendRequest,
      scripts: requestScriptRunner(),
      signal: controller.signal,
    });
    abortRef.current = null;
    setSending(false);
    // Cancelled before a response came back: show the cancellation like before.
    const result: SendOutcome = scripted?.outcome ?? {
      ok: false,
      request: prepareRequest(def, sendVars),
      error: "Request cancelled",
      durationMs: 0,
      sentAt: new Date().toISOString(),
    };
    const prepared = result.request;
    const scripts = scripted && (scripted.preScript || scripted.postScript) ? { pre: scripted.preScript, post: scripted.postScript } : null;
    if (scripted && hasScripts(def)) setScriptVars(scripted.vars);
    setScriptRun(scripts);
    setOutcome(result);
    setOutcomeIsSample(false);
    setSampleLabel(undefined);
    const entryId = newId();
    setShownHistoryId(entryId);
    setHistory((h) =>
      [
        {
          id: entryId,
          method: prepared.method,
          url: prepared.url,
          status: result.ok ? result.response.status : null,
          sentAt: result.sentAt,
          def: structuredClone(def),
          environmentName: activeEnv?.name ?? "",
          durationMs: result.ok ? result.response.durationMs : result.durationMs,
          ...(result.ok
            ? { response: { ...result.response, body: result.response.body.slice(0, MAX_HISTORY_BODY) } }
            : { error: result.error }),
          ...(scripts ? { preScript: scripts.pre, postScript: scripts.post } : {}),
        },
        ...h,
      ].slice(0, MAX_HISTORY),
    );
  }, [def, sending, envVars, scriptVars, sendVars, activeEnv]);

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
    setScriptRun(null);
    setOutcomeIsSample(false);
    setSampleLabel(undefined);
    setShownHistoryId(null);
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

  const openHistory = (h: HistoryEntry) => {
    openDef(h.def);
    setShownHistoryId(h.id);
    setOutcome(historyOutcome(h));
    setScriptRun(h.preScript || h.postScript ? { pre: h.preScript, post: h.postScript } : null);
    setOutcomeIsSample(true);
    setSampleLabel(historyLabel(h));
    setPane("response");
    setNotice(`Loaded the request as sent ${whenLabel(h.sentAt) === "now" ? "just now" : `at ${whenLabel(h.sentAt) || "an earlier time"}`}.`);
  };

  /** Loads the request a batch run was made from, and shows the Batch run pane. */
  const openRunRequest = (request: RequestDef, runLabel: string) => {
    openDef(request);
    setPane("batch");
    setBatchVisited(true);
    setNotice(`Loaded the request from the batch run of ${runLabel}.`);
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
        setSwitcherOpen(false);
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
        setSwitcherOpen(false);
        setDialog({ type: "move", id: a.id, name });
        break;
      }
      case "delete": {
        const taken = removeWithRestore(collections, a.id);
        if (!taken) break;
        setCollections(taken.collections);
        toast.show({ message: `Deleted ${a.label}`, onUndo: () => setCollections((c) => taken.restore(c)) });
        break;
      }
    }
  };

  const addCollection = () => {
    const c = newCollection("New collection");
    setCollections((list) => [...list, c]);
    expand(c.id);
    setRenamingId(c.id);
  };

  const exportWorkspace = async (includeSecrets: boolean) => {
    try {
      const result = await saveTextFile("rest-runner-export.json", toWorkspaceFile(collections, environments, { includeSecrets, suites: readWorkspace().suites, flows: readWorkspace().flows }), "REST Runner export", "json");
      if (result.saved) setNotice(result.path ? `Exported to ${result.path}` : "Export downloaded.");
    } catch (e) {
      setNotice(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Asks about secret values first when there are any to ask about. */
  const startExport = () => {
    if (secretValues(environments).length > 0) setExportDialog(true);
    else void exportWorkspace(false);
  };

  /** Opens the Environment editor on a variable, adding it to the active environment first when nothing defines it yet. */
  const editVariable = (row: VariableRow) => {
    setShowVariables(false);
    if (row.envVarId) {
      setFocusVarId(row.envVarId);
      setShowEnvEditor(true);
      return;
    }
    const target = activeEnv ?? environments[0] ?? null;
    const added = { id: newId(), key: row.name, value: "", enabled: true };
    if (target) {
      const vars = target.vars.filter((v) => v.key !== "" || v.value !== "");
      setEnvironments(environments.map((e) => (e.id === target.id ? { ...e, vars: [...vars, added, emptyRow()] } : e)));
      if (!activeEnv) setActiveEnvId(target.id);
    } else {
      const env = { ...newEnvironment("Environment 1"), vars: [added, emptyRow()] };
      setEnvironments([env]);
      setActiveEnvId(env.id);
    }
    setFocusVarId(added.id);
    setShowEnvEditor(true);
  };

  const importWorkspace = async (file: File) => {
    try {
      const stored = readWorkspace();
      const result = mergeWorkspace(await file.text(), { ...stored, collections, environments });
      const changed = result.counts.suites[0] + result.counts.suites[1] + result.counts.flows[0] + result.counts.flows[1] > 0;
      if (changed && !writeWorkspace(result)) throw new Error("local storage is full");
      setCollections(result.collections);
      expand(...result.collections.filter((c) => !collections.some((x) => x.id === c.id)).map((c) => c.id));
      setEnvironments(result.environments);
      if (changed) shell.onDataChanged(["suites", "flows"]);
      setNotice(describeWorkspaceImport(file.name, result.counts));
    } catch (e) {
      setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Opens what quick open picked. */
  const openItem = (item: QuickItem) => {
    switch (item.kind) {
      case "request":
      case "example": {
        const found = locate(collections, item.id);
        if (found?.kind === "request") {
          expand(found.collection.id, ...found.path.map((f) => f.id));
          openDef(found.node.request);
        } else if (found?.kind === "example") {
          expand(found.collection.id, ...found.path.map((f) => f.id), found.node.id);
          openExample(found.example);
        } else setNotice("That item no longer exists.");
        break;
      }
      case "history": {
        const h = history.find((x) => x.id === item.id);
        if (h) openHistory(h);
        break;
      }
      case "batch-run":
        setOpenRun(item.id);
        break;
    }
  };

  const lastCommand = useRef<number | null>(null);
  useEffect(() => {
    if (!command || lastCommand.current === command.nonce) return;
    lastCommand.current = command.nonce;
    if (command.type === "clear-history") setHistory([]);
    else if (command.type === "reload") {
      setCollections(loadCollections());
      setEnvironments(loadEnvironments());
      setActiveEnvId(load(ACTIVE_ENV_KEY, null));
    }
    else openItem(command.item);
  }, [command]);

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
      if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setRenamingName(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send, saveCurrent, openRun, showEnvEditor, dialog, active]);

  const startSplitDrag = (e: React.PointerEvent) => {
    const el = inspectorRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_COLUMN * 2) return;
    const onMove = (ev: PointerEvent) => {
      const x = Math.min(rect.width - MIN_COLUMN, Math.max(MIN_COLUMN, ev.clientX - rect.left));
      setSplit(x / rect.width);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("dragging-split");
    };
    document.body.classList.add("dragging-split");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onSplitKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const width = inspectorRef.current?.getBoundingClientRect().width ?? 1200;
    const min = MIN_COLUMN / width;
    setSplit((s) => Math.min(1 - min, Math.max(min, s + (e.key === "ArrowLeft" ? -0.02 : 0.02))));
  };

  const unfilled = unresolvedPlaceholders(def, sendVars);
  const guard = guardFor(activeEnv);
  const sends = earlierSends(history, runs.filter((r) => !runDelete.hidden.has(r.id)), def);
  const shownEntry = outcomeIsSample && shownHistoryId ? history.find((h) => h.id === shownHistoryId) : undefined;
  const openBatch = () => {
    setPane("batch");
    setBatchVisited(true);
  };

  const switcher = (
    <RequestSwitcher
      crumbs={crumbs}
      method={def.method}
      name={def.name}
      isExample={located?.kind === "example"}
      unsaved={!savedVersion ? "Not saved" : isDirty ? "Unsaved changes" : null}
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
      renaming={renamingName}
      onRenamingChange={setRenamingName}
      onRename={(name) => patch({ name })}
    >
      <div className="popover-head">
        <span className="section-title">Collections</span>
        <span className="sidebar-actions">
          <button className="link-btn" onClick={addCollection} title="Add a collection">
            New
          </button>
          <label className="link-btn" title="Import a workspace file: collections, environments, test suites and flows">
            Import
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importWorkspace(f);
                e.target.value = "";
              }}
            />
          </label>
          <button className="link-btn" onClick={startExport} title="Export collections, environments, test suites and flows to one file">
            Export workspace…
          </button>
        </span>
      </div>
      <button
        className="primary-outline popover-new"
        onClick={() => {
          openDef(newRequest());
          setSwitcherOpen(false);
        }}
      >
        + New request
      </button>
      {collections.length === 0 && <p className="muted small pad">Click Save in the footer to keep a request in a collection.</p>}
      <div className="tree-scroll">
        <CollectionTree
          collections={collections}
          activeId={openRun === null ? def.id : null}
          expanded={expanded}
          onToggle={toggle}
          renamingId={renamingId}
          onRenamingChange={setRenamingId}
          onOpenRequest={(node) => {
            openDef(node.request);
            setSwitcherOpen(false);
          }}
          onOpenExample={(_node, ex) => {
            openExample(ex);
            setSwitcherOpen(false);
          }}
          onAction={onTreeAction}
        />
      </div>
    </RequestSwitcher>
  );

  return (
    <div className="mode requests-mode">
      <TopBar
        mode="requests"
        onMode={shell.onMode}
        onQuickOpen={shell.onQuickOpen}
        searchPlaceholder="Jump to a request, example, run or history…"
        switcher={switcher}
        environments={environments}
        activeEnvId={activeEnvId}
        onEnvChange={setActiveEnvId}
        onEditEnvironments={() => {
          setFocusVarId(undefined);
          setShowEnvEditor(true);
        }}
        onVariables={() => setShowVariables((v) => !v)}
        variablesOpen={showVariables}
      />
      {showVariables && (
        <VariablesPopover
          rows={requestVariableRows(def, activeEnv, scriptVars)}
          scriptVars={scriptVars}
          envName={activeEnv?.name}
          onEdit={editVariable}
          onClearScriptVar={(name) =>
            setScriptVars((v) => {
              const { [name]: _gone, ...rest } = v;
              return rest;
            })
          }
          onClearAllScriptVars={() => setScriptVars({})}
          onClose={() => setShowVariables(false)}
        />
      )}

      {openRun !== null && (
        <main className="workspace full-view">
          <RunExplorer
            runId={openRun}
            onBack={() => setOpenRun(null)}
            onLoadRequest={(run) => openRunRequest(run.request, run.csvName)}
            onDelete={(id) => {
              const name = runs.find((r) => r.id === id)?.csvName;
              runDelete.request(id, `Deleted the batch run${name ? ` of ${name}` : ""}`);
              setOpenRun(null);
            }}
          />
        </main>
      )}

      <div
        className="inspector"
        hidden={openRun !== null}
        ref={inspectorRef}
        style={{ "--split-a": `${split}fr`, "--split-b": `${1 - split}fr` } as React.CSSProperties}
      >
        <section className="request-col" aria-label="Request">
          <RequestEditor
            def={def}
            onChange={patch}
            envVars={sendVars}
            envName={activeEnv?.name}
            onEnter={() => void send()}
            sectionsKey={SECTIONS_KEY}
            scriptVars={scriptVars}
            onOpenVariables={() => setShowVariables(true)}
          />
          <div className="action-footer">
            {sending ? (
              <button className="send cancel" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button
                className={`send ${guard ? "guarded" : ""}`}
                style={guard ? ({ "--guard": guard.cssColor } as React.CSSProperties) : undefined}
                onClick={() => void send()}
                disabled={def.url.trim() === ""}
                title={unfilled.length > 0 ? `Sends with ${unfilled.map((n) => `{{${n}}}`).join(", ")} as written` : "Send (Ctrl/Cmd + Enter)"}
              >
                {unfilled.length > 0 && <span aria-hidden>⚠ </span>}
                {guard ? guard.send : "Send"}
              </button>
            )}
            <button className="secondary" onClick={saveCurrent} title="Save (Ctrl/Cmd + S)">
              Save{savedVersion && isDirty ? " •" : ""}
            </button>
            <button className={`secondary ghost ${pane === "batch" ? "active" : ""}`} onClick={openBatch} title="Send this request once per CSV row">
              Run with CSV…
            </button>
            <span className="footer-gap" />
            {notice && (
              <span className="small notice" role="status">
                {notice}
              </span>
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
            {(located?.kind === "request" || located?.kind === "example") && (
              <button className="link-btn small" onClick={() => startExample(located.node.id)} title="Keep the current payload as a named example of this request">
                Save as example
              </button>
            )}
          </div>
        </section>

        <div
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize request and response columns"
          aria-valuenow={Math.round(split * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onPointerDown={startSplitDrag}
          onKeyDown={onSplitKey}
          onDoubleClick={() => setSplit(0.55)}
        />

        <section className="response-col" aria-label="Response">
          {(batchVisited || batchRunning) && (
            <div className="pane-switch">
              <div className="segmented" role="tablist" aria-label="Response or batch run">
                <button role="tab" aria-selected={pane === "response"} className={pane === "response" ? "on" : ""} onClick={() => setPane("response")}>
                  Response
                </button>
                <button role="tab" aria-selected={pane === "batch"} className={pane === "batch" ? "on" : ""} onClick={openBatch}>
                  {batchRunning && <span className="pulse-dot" aria-label="Running" />}
                  Batch run
                </button>
              </div>
            </div>
          )}
          <div className="response-main" hidden={pane !== "response"}>
            <ResponsePane
              outcome={outcome}
              sending={sending}
              isSample={outcomeIsSample}
              sampleLabel={sampleLabel}
              scripts={scriptRun}
              bodyNote={
                shownEntry && responseNotKept(shownEntry)
                  ? "This send's response body and headers were not kept. Sends made before this version, or dropped when storage was full, keep only their status."
                  : undefined
              }
              errorHint={
                activeEnv
                  ? `Check that the server is reachable from this computer, or switch environments (using ${activeEnv.name || "an unnamed environment"}).`
                  : undefined
              }
            />
            {sends.length > 0 && (
              <div className="earlier-sends">
                <span className="section-title">Earlier sends of this request</span>
                <div className="earlier-list">
                  {sends.map((item) => {
                    const key = item.kind === "send" ? item.entry.id : item.run.id;
                    const current = item.kind === "send" && item.entry.id === shownHistoryId;
                    return (
                      <button
                        key={key}
                        className={`send-pill tone-${earlierSendTone(item)} ${current ? "current" : ""}`}
                        onClick={() => (item.kind === "send" ? openHistory(item.entry) : setOpenRun(item.run.id))}
                        title={item.kind === "send" ? sendTooltip(item.entry, history) : `Open the batch run from ${item.run.csvName}`}
                      >
                        {earlierSendLabel(item, new Date(), activeEnv?.name)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="batch-main" hidden={pane !== "batch"}>
            <BatchPane def={def} envVars={envVars} scriptVars={scriptVars} envName={activeEnv?.name} onRunningChange={setBatchRunning} onRunSaved={refreshRuns} onOpenRun={setOpenRun} />
          </div>
        </section>
      </div>

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
          focusVarId={focusVarId}
        />
      )}
      {exportDialog && (
        <ExportWorkspaceDialog
          secretCount={secretValues(environments).length}
          onClose={() => setExportDialog(false)}
          onExport={(include) => {
            setExportDialog(false);
            void exportWorkspace(include);
          }}
        />
      )}
    </div>
  );
}
