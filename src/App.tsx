import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BatchPane } from "./components/BatchPane";
import { ExampleDialog, ExportWorkspaceDialog, MoveDialog, SaveRequestDialog, type DestinationChoice } from "./components/CollectionDialogs";
import { CollectionTree, type TreeAction } from "./components/CollectionTree";
import { EnvironmentEditor } from "./components/EnvironmentEditor";
import { RequestEditor } from "./components/request/RequestEditor";
import { RequestSwitcher } from "./components/request/RequestSwitcher";
import { RequestTabBar, showTabBar } from "./components/request/RequestTabBar";
import { ResponsePane } from "./components/ResponsePane";
import { RunExplorer } from "./components/RunExplorer";
import { MOD_KEY, TopBar } from "./components/shell/TopBar";
import { useToast } from "./components/shell/Toast";
import { useDeferredDelete } from "./components/shell/useDeferredDelete";
import { VariablesProvider } from "./components/variables/VariablesContext";
import { loadPanelState, savePanelState, VariablesPanel, DOCK_MIN_WIDTH, type VariablesPanelState } from "./components/variables/VariablesPanel";
import { useViewportWidth } from "./components/useViewportWidth";
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
import { newRequest } from "./lib/defaults";
import { earlierSendLabel, earlierSends, earlierSendTone, sendTooltip, whenLabel } from "./lib/earlierSends";
import { fitHistory, historyLabel, historyOutcome, MAX_HISTORY_BODY, responseNotKept } from "./lib/history";
import { environmentVars, guardFor, loadEnvironments, type Environment } from "./lib/environments";
import { loadCertificates, saveCertificates } from "./lib/certificates";
import { certificatesForExport, describeCertificateImport, importCertificates } from "./lib/certificatesFile";
import { isTauri, sendRequest } from "./lib/http";
import { newId } from "./lib/ids";
import { prepareRequest, requestPlaceholders, unresolvedPlaceholders } from "./lib/request";
import { secretValues } from "./lib/secrets";
import { hasScripts, requestScriptRunner, sendWithScripts } from "./lib/requestScripts";
import type { Vars } from "./lib/template";
import type { ScriptOutput } from "./lib/testing/types";
import type { RunSummary } from "./lib/run";
import { readableUrl, type QuickItem } from "./lib/quickOpen";
import { deleteRun, listRuns } from "./lib/runStore";
import { saveTextFile } from "./lib/saveFile";
import { describeWorkspaceImport, importWorkspace as mergeWorkspace, toWorkspaceFile } from "./lib/workspace";
import { readWorkspace, writeWorkspace } from "./lib/workspaceStore";
import {
  activate,
  closeOthers,
  closeSaved,
  closeTab,
  displayOrder,
  duplicateTab,
  isTabDirty,
  loadTabs,
  newTab,
  pin,
  reopenClosed,
  unpin,
  openInTab,
  promote,
  goToTab,
  savedVersionOf,
  serializeTabs,
  stepTab,
  tabShortcut,
  updateActiveDef,
  updateTabDef,
  type RequestTab,
  type TabsState,
} from "./lib/requestTabs";
import { load, save } from "./lib/storage";
import type { HistoryEntry, RequestDef, SendOutcome } from "./lib/types";

type LowerPane = "response" | "batch";

const TABS_KEY = "rest-runner.tabs";
/** Single working copy kept before tabs existed; read once to migrate into the first tab, never written. */
const LEGACY_DRAFT_KEY = "rest-runner.draft";
const HISTORY_KEY = "rest-runner.history";
const MAX_HISTORY = 50;
/** Old flat list of saved requests; read once to migrate into collections. */
const SAVED_KEY = "rest-runner.saved";
const COLLECTIONS_KEY = "rest-runner.collections";
const EXPANDED_KEY = "rest-runner.expanded";
const ENVIRONMENTS_KEY = "rest-runner.environments";
const ACTIVE_ENV_KEY = "rest-runner.active-environment";
const DETAILS_KEY = "rest-runner.request-details";
const SPLIT_KEY = "rest-runner.split";
/** Variables set by request scripts (rr.vars.set), kept between sends. */
const SCRIPT_VARS_KEY = "rest-runner.script-vars";
const MIN_COLUMN = 380;

/** What belongs to one open request but is not saved: its response, pane and batch state. */
interface TabRuntime {
  outcome: SendOutcome | null;
  scriptRun: { pre?: ScriptOutput; post?: ScriptOutput } | null;
  /** Script variables right after the send shown, for the Scripts tab. Missing for samples and history. */
  scriptVarsAfter?: Vars;
  outcomeIsSample: boolean;
  sampleLabel?: string;
  shownHistoryId: string | null;
  sending: boolean;
  pane: LowerPane;
  batchVisited: boolean;
  /** A batch is running or its results are on screen: the request column folds into a summary bar. */
  batchWide: boolean;
  batchRunning: boolean;
}

const INITIAL_RUNTIME: TabRuntime = {
  outcome: null,
  scriptRun: null,
  outcomeIsSample: false,
  sampleLabel: undefined,
  shownHistoryId: null,
  sending: false,
  pane: "response",
  batchVisited: false,
  batchWide: false,
  batchRunning: false,
};

function readTabs(): TabsState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TABS_KEY);
  } catch {
    /* storage unavailable: start fresh */
  }
  return loadTabs(raw, load<unknown>(LEGACY_DRAFT_KEY, null));
}

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

/** One tab's BatchPane. Its callbacks stay the same between renders, which BatchPane's effects rely on. */
function TabBatch({
  tab,
  envVars,
  scriptVars,
  envName,
  patchRuntime,
  onRunSaved,
  onOpenRun,
}: {
  tab: RequestTab;
  envVars: Vars;
  scriptVars: Vars;
  envName?: string;
  patchRuntime: (id: string, p: Partial<TabRuntime>) => void;
  onRunSaved: () => void;
  onOpenRun: (id: string) => void;
}) {
  const id = tab.id;
  const onRunningChange = useCallback((batchRunning: boolean) => patchRuntime(id, { batchRunning }), [id, patchRuntime]);
  const onWideChange = useCallback((batchWide: boolean) => patchRuntime(id, { batchWide }), [id, patchRuntime]);
  return <BatchPane def={tab.def} envVars={envVars} scriptVars={scriptVars} envName={envName} onRunningChange={onRunningChange} onWideChange={onWideChange} onRunSaved={onRunSaved} onOpenRun={onOpenRun} />;
}

export default function App({ active = true, shell, command }: Props) {
  const [tabs, setTabs] = useState<TabsState>(readTabs);
  /** Always the latest tabs, so handlers can read the result of the change they just made. */
  const tabsRef = useRef(tabs);
  const [runtime, setRuntime] = useState<Record<string, TabRuntime>>({});
  const aborts = useRef(new Map<string, AbortController>());
  const [scriptVars, setScriptVars] = useState<Vars>(() => load<Vars>(SCRIPT_VARS_KEY, {}));
  const [history, setHistory] = useState<HistoryEntry[]>(() => load(HISTORY_KEY, []));
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>(loadCollections);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(load<string[] | null>(EXPANDED_KEY, null) ?? collections.map((c) => c.id)),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>(loadEnvironments);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(() => load(ACTIVE_ENV_KEY, null));
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [focusVarId, setFocusVarId] = useState<string | undefined>(undefined);
  const [variablesPanel, setVariablesPanel] = useState<VariablesPanelState>(loadPanelState);
  const viewportWidth = useViewportWidth();
  const [exportDialog, setExportDialog] = useState(false);
  const toast = useToast();
  const notify = useCallback((message: string) => toast.show({ message }), [toast]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [renamingName, setRenamingName] = useState(false);
  const [split, setSplit] = useState<number>(() => {
    const v = load<number>(SPLIT_KEY, 0.55);
    return typeof v === "number" && v > 0.1 && v < 0.9 ? v : 0.55;
  });
  const inspectorRef = useRef<HTMLDivElement>(null);

  const applyTabs = useCallback((change: (s: TabsState) => TabsState): TabsState => {
    const next = change(tabsRef.current);
    if (next !== tabsRef.current) {
      tabsRef.current = next;
      setTabs(next);
    }
    return next;
  }, []);
  const patchRuntime = useCallback((id: string, p: Partial<TabRuntime>) => setRuntime((r) => ({ ...r, [id]: { ...(r[id] ?? INITIAL_RUNTIME), ...p } })), []);

  const activeTab = tabs.tabs.find((t) => t.id === tabs.activeId) ?? tabs.tabs[0];
  const activeId = activeTab.id;
  const def = activeTab.def;
  const rt = runtime[activeId] ?? INITIAL_RUNTIME;
  const { outcome, scriptRun, scriptVarsAfter, outcomeIsSample, sampleLabel, shownHistoryId, sending, pane, batchVisited, batchWide, batchRunning } = rt;
  const setPane = (p: LowerPane) => patchRuntime(activeId, { pane: p });

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;
  const envVars = useMemo(() => environmentVars(activeEnv), [activeEnv]);
  /** What placeholders resolve against: environment, then variables scripts have set. */
  const sendVars = useMemo(() => ({ ...envVars, ...scriptVars }), [envVars, scriptVars]);
  const located = useMemo(() => locate(collections, def.id), [collections, def.id]);
  const savedVersion = savedVersionOf(def, collections);
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

  const dirtyIds = useMemo(() => new Set(tabs.tabs.filter((t) => isTabDirty(t, collections)).map((t) => t.id)), [tabs.tabs, collections]);
  const busyIds = useMemo(() => new Set(tabs.tabs.filter((t) => runtime[t.id]?.sending || runtime[t.id]?.batchRunning).map((t) => t.id)), [tabs.tabs, runtime]);
  const tabName = (t: RequestTab) => t.def.name || "Untitled request";

  const activateTab = (id: string) => {
    applyTabs((s) => activate(s, id));
    setOpenRun(null);
  };
  const openNewTab = () => {
    applyTabs(newTab);
    setOpenRun(null);
  };
  /** Closes a tab. Unsaved changes are not asked about: the toast offers Undo instead. */
  const closeTabById = (id: string) => {
    const t = tabsRef.current.tabs.find((x) => x.id === id);
    if (!t) return;
    if (t.pinned) {
      notify(`Unpin ${tabName(t)} to close it.`);
      return;
    }
    if (runtime[id]?.batchRunning) {
      notify(`Stop the batch in ${tabName(t)} before closing it.`);
      return;
    }
    const dirty = isTabDirty(t, collections);
    applyTabs((s) => closeTab(s, id, displayOrder(s.tabs, collections)));
    if (dirty) toast.show({ message: `Closed ${tabName(t)} with unsaved changes`, onUndo: () => applyTabs((s) => reopenClosed(s, id)) });
  };
  const closeOtherTabs = (id: string) => {
    const before = tabsRef.current;
    const next = applyTabs((s) => closeOthers(s, id, (t) => !!runtime[t.id]?.batchRunning));
    const gone = before.tabs.filter((t) => !next.tabs.some((x) => x.id === t.id));
    const lost = gone.filter((t) => isTabDirty(t, collections));
    if (lost.length > 0)
      toast.show({
        message: `Closed ${lost.length} ${lost.length === 1 ? "tab" : "tabs"} with unsaved changes`,
        onUndo: () => applyTabs((s) => gone.reduce((acc, t) => reopenClosed(acc, t.id), s)),
      });
  };
  const closeSavedTabs = () => applyTabs((s) => closeSaved(s, (t) => isTabDirty(t, collections) || !!runtime[t.id]?.batchRunning, displayOrder(s.tabs, collections)));
  const reopenLast = () => applyTabs((s) => reopenClosed(s));
  const revealTab = (id: string) => {
    const t = tabsRef.current.tabs.find((x) => x.id === id);
    if (!t) return;
    activateTab(id);
    const found = locate(collections, t.def.id);
    if (found?.kind === "request" || found?.kind === "example") {
      expand(found.collection.id, ...found.path.map((f) => f.id), ...(found.kind === "example" ? [found.node.id] : []));
      setSwitcherOpen(true);
    } else notify(`${tabName(t)} is not saved in a collection yet.`);
  };

  /** Kept in a ref so the one keydown listener always sees the current tabs. Returns true when the key was a tab command. */
  const handleTabKey = useRef((_e: KeyboardEvent): boolean => false);
  handleTabKey.current = (e) => {
    const key = tabShortcut(e);
    if (!key) return false;
    e.preventDefault();
    const order = displayOrder(tabsRef.current.tabs, collections);
    if (key.type === "new") openNewTab();
    else if (key.type === "close") closeTabById(tabsRef.current.activeId);
    else if (key.type === "reopen") reopenLast();
    else {
      applyTabs((s) => (key.type === "goto" ? goToTab(s, order, key.n) : stepTab(s, order, key.type === "next" ? 1 : -1)));
      setOpenRun(null);
    }
    return true;
  };

  const refreshRuns = useCallback(() => {
    listRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);
  useEffect(refreshRuns, [refreshRuns]);
  const runDelete = useDeferredDelete(deleteRun, refreshRuns);

  useEffect(() => {
    save(TABS_KEY, serializeTabs(tabs));
  }, [tabs]);
  useEffect(() => {
    // A tab that is gone (closed, or a preview replaced) stops its send and drops its response. Closed tabs keep theirs for Undo.
    const open = new Set(tabs.tabs.map((t) => t.id));
    for (const [id, controller] of aborts.current) if (!open.has(id)) controller.abort();
    const keep = new Set([...open, ...tabs.closed.map((t) => t.id)]);
    setRuntime((r) => {
      const stale = Object.keys(r).filter((id) => !keep.has(id));
      if (stale.length === 0) return r;
      const next = { ...r };
      for (const id of stale) delete next[id];
      return next;
    });
  }, [tabs]);
  useEffect(() => {
    // Responses make history larger; if storage is full, drop the oldest responses until it fits.
    fitHistory(history, (h) => save(HISTORY_KEY, h));
  }, [history]);

  const patch = (p: Partial<RequestDef>) => applyTabs((s) => updateActiveDef(s, p));

  const send = useCallback(async () => {
    // Everything below belongs to the tab the send started in, even if the user switches tabs meanwhile.
    const tabId = activeId;
    if (rt.sending || def.url.trim() === "") return;
    const sentDef = def;
    applyTabs((s) => promote(s, tabId));
    patchRuntime(tabId, { pane: "response", sending: true });
    const controller = new AbortController();
    aborts.current.set(tabId, controller);
    let scripted: Awaited<ReturnType<typeof sendWithScripts>>;
    try {
      scripted = await sendWithScripts({
        def: sentDef,
        env: envVars,
        data: {},
        vars: scriptVars,
        iteration: 0,
        send: sendRequest,
        scripts: requestScriptRunner(),
        signal: controller.signal,
      });
    } finally {
      if (aborts.current.get(tabId) === controller) aborts.current.delete(tabId);
    }
    // Cancelled before a response came back: show the cancellation like before.
    const result: SendOutcome = scripted?.outcome ?? {
      ok: false,
      request: prepareRequest(sentDef, sendVars),
      error: "Request cancelled",
      durationMs: 0,
      sentAt: new Date().toISOString(),
    };
    const prepared = result.request;
    const scripts = scripted && (scripted.preScript || scripted.postScript) ? { pre: scripted.preScript, post: scripted.postScript } : null;
    if (scripted && hasScripts(sentDef)) setScriptVars(scripted.vars);
    const entryId = newId();
    const stillThere = tabsRef.current.tabs.some((t) => t.id === tabId) || tabsRef.current.closed.some((t) => t.id === tabId);
    if (stillThere)
      patchRuntime(tabId, { sending: false, scriptRun: scripts, scriptVarsAfter: scripts ? scripted?.vars : undefined, outcome: result, outcomeIsSample: false, sampleLabel: undefined, shownHistoryId: entryId });
    setHistory((h) =>
      [
        {
          id: entryId,
          method: prepared.method,
          url: prepared.url,
          status: result.ok ? result.response.status : null,
          sentAt: result.sentAt,
          def: structuredClone(sentDef),
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
  }, [def, activeId, rt.sending, envVars, scriptVars, sendVars, activeEnv, applyTabs, patchRuntime]);

  /** Cancels the send in the tab on screen; other tabs keep going. */
  const cancel = () => aborts.current.get(activeId)?.abort();

  const saveCurrent = useCallback(() => {
    const copy = structuredClone(def);
    if (located?.kind === "request") {
      setCollections((c) => updateRequest(c, copy));
      notify(`Saved "${copy.name}".`);
    } else if (located?.kind === "example") {
      setCollections((c) => updateExample(c, copy));
      notify(`Saved example "${copy.name}".`);
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

  /**
   * Opens a request in a tab: a preview tab (single click) unless `permanent`. `load` replaces the working copy
   * of a tab that is already open (history, batch run). Returns the tab and whether it starts with a clean slate.
   */
  const openTab = (d: RequestDef, o: { permanent?: boolean; load?: boolean } = {}) => {
    const before = tabsRef.current;
    const next = applyTabs((s) => openInTab(s, d, { preview: !o.permanent, load: o.load }));
    const isNew = !before.tabs.some((t) => t.id === next.activeId);
    if (isNew) setRuntime((r) => ({ ...r, [next.activeId]: INITIAL_RUNTIME }));
    else if (o.load)
      patchRuntime(next.activeId, { outcome: null, scriptRun: null, scriptVarsAfter: undefined, outcomeIsSample: false, sampleLabel: undefined, shownHistoryId: null });
    setOpenRun(null);
    return { id: next.activeId, isNew };
  };

  const openDef = (d: RequestDef, permanent = false) => openTab(d, { permanent });

  const openExample = (ex: RequestExample, permanent = false) => {
    const { id, isNew } = openTab(ex.request, { permanent });
    if (isNew && ex.response) patchRuntime(id, { outcome: sampleOutcome(ex, ex.response, envVars), outcomeIsSample: true, pane: "response" });
  };

  const openHistory = (h: HistoryEntry, permanent = false) => {
    const { id } = openTab(h.def, { permanent, load: true });
    patchRuntime(id, {
      shownHistoryId: h.id,
      outcome: historyOutcome(h),
      scriptRun: h.preScript || h.postScript ? { pre: h.preScript, post: h.postScript } : null,
      scriptVarsAfter: undefined,
      outcomeIsSample: true,
      sampleLabel: historyLabel(h),
      pane: "response",
    });
    notify(`Loaded the request as sent ${whenLabel(h.sentAt) === "now" ? "just now" : `at ${whenLabel(h.sentAt) || "an earlier time"}`}.`);
  };

  /** Loads the request a batch run was made from, and shows the Batch run pane. */
  const openRunRequest = (request: RequestDef, runLabel: string) => {
    const { id } = openTab(request, { permanent: true, load: true });
    applyTabs((s) => promote(s, id));
    patchRuntime(id, { pane: "batch", batchVisited: true });
    notify(`Loaded the request from the batch run of ${runLabel}.`);
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
        openDef(r, true);
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
        applyTabs((s) => ({ ...s, tabs: s.tabs.map((t) => (t.def.id === a.id ? { ...t, def: { ...t.def, name: a.name } } : t)) }));
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
        // Tabs showing what was deleted stay open, now unsaved (and Undo makes them saved again).
        const orphaned = tabsRef.current.tabs.filter((t) => locate(collections, t.def.id) && !locate(taken.collections, t.def.id)).length;
        const note = orphaned === 0 ? "" : `. ${orphaned === 1 ? "Its open tab stays" : `${orphaned} open tabs stay`} as unsaved ${orphaned === 1 ? "request" : "requests"}`;
        toast.show({ message: `Deleted ${a.label}${note}`, onUndo: () => setCollections((c) => taken.restore(c)) });
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

  /** Entries whose files the desktop app holds, so an export could carry them. */
  const certificateFileCount = () => (isTauri() ? loadCertificates().filter((c) => !c.needsFile).length : 0);

  const exportWorkspace = async (includeSecrets: boolean, includeCertificateFiles = false) => {
    try {
      const certificates = await certificatesForExport(loadCertificates(), includeCertificateFiles && isTauri());
      const result = await saveTextFile("rest-runner-export.json", toWorkspaceFile(collections, environments, { includeSecrets, suites: readWorkspace().suites, flows: readWorkspace().flows, certificates }), "REST Runner export", "json");
      if (result.saved) notify(result.path ? `Exported to ${result.path}` : "Export downloaded.");
    } catch (e) {
      notify(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Asks about secret values and certificate files first when there are any to ask about. */
  const startExport = () => {
    if (secretValues(environments).length > 0 || certificateFileCount() > 0) setExportDialog(true);
    else void exportWorkspace(false);
  };

  const patchVariablesPanel = useCallback((patch: Partial<VariablesPanelState>) => setVariablesPanel((p) => ({ ...p, ...patch })), []);
  /** Opens the sidebar on the variables this request uses. */
  const openVariables = useCallback(() => patchVariablesPanel({ open: true, filter: "request" }), [patchVariablesPanel]);
  const closeVariables = useCallback(() => {
    if (document.getElementById("variables-panel")?.contains(document.activeElement)) document.querySelector<HTMLElement>("[data-variables-trigger]")?.focus();
    patchVariablesPanel({ open: false });
  }, [patchVariablesPanel]);
  useEffect(() => {
    savePanelState(variablesPanel);
  }, [variablesPanel]);

  /** Certificate rules in a workspace file, merged into the Certificates list. Returns text for the notice, or null when the file has none. */
  const importCertificatesFrom = async (text: string): Promise<string | null> => {
    let data: unknown;
    try {
      data = (JSON.parse(text) as { certificates?: unknown }).certificates;
    } catch {
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    const r = await importCertificates(data, loadCertificates());
    if (r.added + r.updated > 0) saveCertificates(r.entries);
    return describeCertificateImport(r);
  };

  const importWorkspace = async (file: File) => {
    try {
      const stored = readWorkspace();
      const text = await file.text();
      const result = mergeWorkspace(text, { ...stored, collections, environments });
      const changed = result.counts.suites[0] + result.counts.suites[1] + result.counts.flows[0] + result.counts.flows[1] > 0;
      if (changed && !writeWorkspace(result)) throw new Error("local storage is full");
      setCollections(result.collections);
      expand(...result.collections.filter((c) => !collections.some((x) => x.id === c.id)).map((c) => c.id));
      setEnvironments(result.environments);
      if (changed) shell.onDataChanged(["suites", "flows"]);
      const certificates = await importCertificatesFrom(text);
      const warned = result.warnings?.length ? ` ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}: ${result.warnings.join(" ")}` : "";
      notify(`${describeWorkspaceImport(file.name, result.counts)}${certificates ? ` ${certificates}` : ""}${warned}`);
    } catch (e) {
      notify(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Opens what quick open picked. */
  const openItem = (item: QuickItem, permanent = false) => {
    switch (item.kind) {
      case "request":
      case "example": {
        const found = locate(collections, item.id);
        if (found?.kind === "request") {
          expand(found.collection.id, ...found.path.map((f) => f.id));
          openDef(found.node.request, permanent);
        } else if (found?.kind === "example") {
          expand(found.collection.id, ...found.path.map((f) => f.id), found.node.id);
          openExample(found.example, permanent);
        } else notify("That item no longer exists.");
        break;
      }
      case "history": {
        const h = history.find((x) => x.id === item.id);
        if (h) openHistory(h, permanent);
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
    else openItem(command.item, command.permanent);
  }, [command]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || showEnvEditor || dialog !== null) return;
      // Tab commands work from anywhere in Requests, including a text field and the batch run view.
      if (handleTabKey.current(e)) return;
      if (openRun !== null) return;
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

  const usedNames = useMemo(() => requestPlaceholders(def), [def]);
  const unfilled = unresolvedPlaceholders(def, sendVars);
  const foldRequest = pane === "batch" && batchWide && openRun === null;
  const summaryUrl = foldRequest ? prepareRequest(def, sendVars).url : "";
  const guard = guardFor(activeEnv);
  const sends = earlierSends(history, runs.filter((r) => !runDelete.hidden.has(r.id)), def);
  const shownEntry = outcomeIsSample && shownHistoryId ? history.find((h) => h.id === shownHistoryId) : undefined;
  const openBatch = () => {
    // A batch belongs to its tab, so the tab must not be replaced as a preview.
    applyTabs((s) => promote(s, activeId));
    patchRuntime(activeId, { pane: "batch", batchVisited: true });
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
          openDef(newRequest(), true);
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
          onOpenRequest={(node, permanent) => {
            openDef(node.request, permanent);
            if (permanent) setSwitcherOpen(false);
          }}
          onOpenExample={(_node, ex, permanent) => {
            openExample(ex, permanent);
            if (permanent) setSwitcherOpen(false);
          }}
          onAction={onTreeAction}
        />
      </div>
    </RequestSwitcher>
  );

  return (
    <VariablesProvider
      environments={environments}
      activeEnvId={activeEnvId}
      scriptVars={scriptVars}
      setEnvironments={setEnvironments}
      setActiveEnvId={setActiveEnvId}
      setScriptVars={setScriptVars}
      onShowInSidebar={openVariables}
    >
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
        onVariables={() => (variablesPanel.open ? closeVariables() : openVariables())}
        variablesOpen={variablesPanel.open}
      />
      {showTabBar(tabs.tabs) && (
        <RequestTabBar
          tabs={tabs.tabs}
          activeId={activeId}
          collections={collections}
          dirtyIds={dirtyIds}
          busyIds={busyIds}
          canReopen={tabs.closed.length > 0}
          onActivate={activateTab}
          onClose={closeTabById}
          onNew={openNewTab}
          onPin={(id) => applyTabs((s) => pin(s, id))}
          onUnpin={(id) => applyTabs((s) => unpin(s, id))}
          onDuplicate={(id) => applyTabs((s) => duplicateTab(s, id))}
          onReveal={revealTab}
          onCloseOthers={closeOtherTabs}
          onCloseSaved={closeSavedTabs}
          onReopen={reopenLast}
        />
      )}
      <div className="requests-body">
        <div className="requests-main">
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

      {foldRequest && (
        <div className="request-summary-bar" aria-label="Request">
          <span className={`method m-${def.method.toLowerCase()}`}>{def.method}</span>
          <strong className="request-summary-name" title={def.name}>
            {def.name || "Untitled request"}
          </strong>
          <span className="request-summary-url mono" title={summaryUrl}>
            {readableUrl(summaryUrl)}
          </span>
          <button className="secondary" onClick={() => setPane("response")} title="Show the request again. The batch results stay where they are.">
            Edit request
          </button>
        </div>
      )}
      <div
        className={`inspector ${foldRequest ? "request-folded" : ""}`}
        hidden={openRun !== null}
        ref={inspectorRef}
        // Percent-sized factors: with factors below 1, a column held at its minimum width would leave the rest unused.
        style={{ "--split-a": `${split * 100}fr`, "--split-b": `${(1 - split) * 100}fr` } as React.CSSProperties}
      >
        <section className="request-col" id="request-panel" role="tabpanel" aria-label="Request">
          <RequestEditor
            key={activeId}
            def={def}
            onChange={patch}
            envVars={sendVars}
            envName={activeEnv?.name}
            onEnter={() => void send()}
            detailsKey={DETAILS_KEY}
            scriptVars={scriptVars}
            onOpenVariables={openVariables}
            sendSlot={
              sending ? (
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
              )
            }
            menuItems={[
              { label: savedVersion && isDirty ? "Save •" : "Save", hint: `${MOD_KEY} S`, onSelect: saveCurrent },
              ...(located?.kind === "request" || located?.kind === "example"
                ? [{ label: "Save as example", title: "Keep the current payload as a named example of this request", onSelect: () => startExample(located.node.id) }]
                : []),
              ...(located?.kind === "example" && liveResponse
                ? [
                    {
                      label: "Set sample response",
                      title: "Keep the last response as this example's sample response",
                      onSelect: () => {
                        setCollections((c) => setExampleResponse(c, def.id, sampleFromResponse(liveResponse)));
                        notify("Saved the response as the sample.");
                      },
                    },
                  ]
                : []),
              { label: "Run with CSV…", title: "Send this request once per CSV row", onSelect: openBatch },
            ]}
          />
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
              key={activeId}
              outcome={outcome}
              sending={sending}
              isSample={outcomeIsSample}
              sampleLabel={sampleLabel}
              scripts={scriptRun}
              scriptVars={scriptVarsAfter}
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
          {tabs.tabs
            .filter((t) => runtime[t.id]?.batchVisited || runtime[t.id]?.batchRunning)
            .map((t) => (
              <div className="batch-main" key={t.id} hidden={t.id !== activeId || pane !== "batch"}>
                <TabBatch
                  tab={t}
                  envVars={envVars}
                  scriptVars={scriptVars}
                  envName={activeEnv?.name}
                  patchRuntime={patchRuntime}
                  onRunSaved={refreshRuns}
                  onOpenRun={setOpenRun}
                />
              </div>
            ))}
        </section>
      </div>
        </div>
        <VariablesPanel
          state={variablesPanel}
          onState={patchVariablesPanel}
          used={usedNames}
          docked={viewportWidth >= DOCK_MIN_WIDTH}
          onClose={closeVariables}
          onEditEnvironments={(varId) => {
            setFocusVarId(varId);
            setShowEnvEditor(true);
          }}
          onSwitchEnvironment={setActiveEnvId}
        />
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
            applyTabs((t) => updateTabDef(t, activeId, () => copy));
            expand(dest.collectionId, dest.folderId);
            setDialog(null);
            notify(`Saved "${name}".`);
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
            // The new example opens in its own tab; with a sample kept, that tab shows it.
            const { id } = openTab(r.example.request, { permanent: true });
            if (includeResponse && dialog.response) patchRuntime(id, { outcome: sampleOutcome(r.example, dialog.response, envVars), outcomeIsSample: true });
            setDialog(null);
            notify(`Saved example "${name}".`);
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
          certificateFileCount={certificateFileCount()}
          onExport={(include, includeCertificateFiles) => {
            setExportDialog(false);
            void exportWorkspace(include, includeCertificateFiles);
          }}
        />
      )}
    </div>
    </VariablesProvider>
  );
}
