import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { setBusy } from "../../lib/busyWork";
import { cleanCollections, COLLECTIONS_KEY } from "../../lib/collections";
import { environmentVars, guardFor, loadEnvironments, mergeHydrated, onSecretsHydrated, saveEnvironments, type Environment } from "../../lib/environments";
import type { RequestLookup } from "../../lib/flows/flows";
import { sendRequest } from "../../lib/http";
import { saveTextFile } from "../../lib/saveFile";
import { storedSecrets } from "../../lib/secrets";
import { setSectionStatus } from "../../lib/sectionStatus";
import { reinsert, removeById } from "../../lib/listUndo";
import { isString, load, save } from "../../lib/storage";
import { setLeaveGuard } from "../../lib/unsavedWork";
import { createWorkerScriptRunner } from "../../lib/testing/scriptRunner";
import { listPickableRequests } from "../../lib/testing/requestSources";
import { isDirty, saveBlockers, tidyTool } from "../../lib/tools/builder";
import { canRetryAlone } from "../../lib/tools/engine";
import { clearLookups, listLookups } from "../../lib/tools/lookupStore";
import { sampleCollection, sampleTool, SAMPLE_COLLECTION_NAME } from "../../lib/tools/sample";
import { SessionRegistry, type ToolSession } from "../../lib/tools/session";
import { snapshotFileName, toToolSnapshot } from "../../lib/tools/snapshot";
import { loadTools, newTool, saveTools, validateTool } from "../../lib/tools/tools";
import { describeToolsImport, importToolsFile, toToolsFile } from "../../lib/tools/toolsFile";
import type { LookupRecord, Tool } from "../../lib/tools/types";
import { callView, environmentNames, lookupAsText, requestLine } from "../../lib/tools/view";
import type { ShellCommand, ShellProps } from "../../Root";
import { SectionVariablesPanel } from "../variables/SectionVariablesPanel";
import { TrashIcon } from "../shell/Icons";
import { OverflowMenu } from "../shell/OverflowMenu";
import { useToast } from "../shell/Toast";
import { TopBar } from "../shell/TopBar";
import { TitleSwitcher } from "../shell/TitleSwitcher";
import { useCollapsed } from "../shell/useCollapsed";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { ToolBuild } from "./ToolBuild";
import { UnsavedDialog } from "./UnsavedDialog";
import { ToolsSidebar } from "./ToolsSidebar";
import { ToolUse } from "./ToolUse";
import { useToolSession } from "./useToolSession";
import "./tools.css";

const OPEN_TOOL_KEY = "rest-runner.tool-open";
const MODE_KEY = "rest-runner.tools-mode";

export type ToolsMode = "use" | "build";

interface Props {
  /** True when Tools is on screen. */
  active: boolean;
  shell: ShellProps;
  command: ShellCommand | null;
}

function readRequests(): RequestLookup {
  const byId = new Map(listPickableRequests().map((r) => [r.id, r.request]));
  return (id) => byId.get(id) ?? null;
}

/**
 * Tools mode: small lookup pages. Use mode (the default) runs a tool and shows its blocks; Build mode edits it.
 * Each tool keeps its own environment (tool.settings.environmentId) and its own lookup session, so a lookup keeps
 * running while another tool or section is on screen.
 */
export function ToolsApp({ active, shell, command }: Props) {
  const [navCollapsed, toggleNav] = useCollapsed("rest-runner.tools-nav-collapsed");
  const [tools, setTools] = useState<Tool[]>(loadTools);
  const [openToolId, setOpenToolId] = useState<string | null>(() => load<string | null>(OPEN_TOOL_KEY, null, isString));
  const [mode, setMode] = useState<ToolsMode>(() => (load<string>(MODE_KEY, "use") === "build" ? "build" : "use"));
  const [environments, setEnvironments] = useState<Environment[]>(loadEnvironments);
  // The keychain can finish loading after first render: fill in secrets without losing edits.
  useEffect(() => onSecretsHydrated(() => setEnvironments((cur) => mergeHydrated(cur, loadEnvironments()))), []);
  const [findRequest, setFindRequest] = useState<RequestLookup>(readRequests);
  const [recents, setRecents] = useState<LookupRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const registry = useMemo(() => new SessionRegistry(), []);
  // Build mode has its own sessions (sample inputs and Run with sample answers), so they never mix with Use mode's.
  const buildRegistry = useMemo(() => new SessionRegistry(), []);
  // Edits made in Build mode, by tool id. They are kept (and the tool saved) only by Save.
  const [drafts, setDrafts] = useState<Record<string, Tool>>({});
  const [leaving, setLeaving] = useState<{ go: () => void } | null>(null);
  // The confirm step of an Action button: the dialog on screen, and the answer it will give.
  const [asking, setAsking] = useState<{ action: string; request: string; guard: { name: string; cssColor: string } | null; text?: string; answer: (ok: boolean) => void } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const scripts = useMemo(() => createWorkerScriptRunner(), []);
  useEffect(() => () => scripts.dispose(), [scripts]);
  const toast = useToast();

  useEffect(() => {
    if (!saveTools(tools)) setNotice("Could not save tools: local storage is full.");
  }, [tools]);
  useEffect(() => {
    save(OPEN_TOOL_KEY, openToolId);
  }, [openToolId]);
  useEffect(() => {
    save(MODE_KEY, mode);
  }, [mode]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Requests and environments are edited in the other sections; pick up changes whenever Tools is shown.
  useEffect(() => {
    if (!active) return;
    setEnvironments(loadEnvironments());
    setFindRequest(() => readRequests());
  }, [active]);

  const tool = tools.find((t) => t.id === openToolId) ?? null;
  const session = registry.get(tool?.id ?? "");
  const state = useToolSession(session);
  const buildSession = buildRegistry.get(tool?.id ?? "");
  const buildState = useToolSession(buildSession);
  const draft = tool ? drafts[tool.id] : undefined;
  const dirty = isDirty(tool ?? undefined, draft);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const problems = useMemo(() => (tool ? validateTool(tool, findRequest) : []), [tool, findRequest]);
  const environment = environments.find((e) => e.id === tool?.settings.environmentId) ?? null;
  const guardInfo = guardFor(environment);
  const guard = guardInfo ? { name: guardInfo.name, cssColor: guardInfo.cssColor } : null;

  // Re-render when any session changes (the sidebar shows which tools are running).
  useSyncExternalStore(registry.subscribe, registry.getVersion);
  useSyncExternalStore(buildRegistry.subscribe, buildRegistry.getVersion);
  const runningIds = registry.runningIds();
  const anyRunning = runningIds.length > 0 || buildRegistry.runningIds().length > 0;
  useEffect(() => setBusy("tools", anyRunning), [anyRunning]);
  const lookingUp = runningIds.length > 0;
  useEffect(() => setSectionStatus("tools", { running: lookingUp }), [lookingUp]);

  const updateTool = useCallback((next: Tool) => {
    setTools((list) => {
      const before = list.find((t) => t.id === next.id);
      // Turning "keep recent lookups" off removes what was kept.
      if (before?.settings.keepHistory && !next.settings.keepHistory) {
        void clearLookups(next.id).then(() => setRecents((r) => (r.length && r[0].toolId === next.id ? [] : r)));
      }
      return list.map((t) => (t.id === next.id ? next : t));
    });
  }, []);

  /** Changes the draft (Build mode edits). The saved tool stays as it is until Save. */
  const editDraft = useCallback((next: Tool) => setDrafts((d) => ({ ...d, [next.id]: next })), []);
  const dropDraft = useCallback((id: string) => {
    setDrafts((d) => {
      if (!(id in d)) return d;
      const { [id]: _gone, ...rest } = d;
      void _gone;
      return rest;
    });
  }, []);

  /** Keeps the draft: prunes mappings no longer used, closes gaps between rows, and saves through updateTool. False when it cannot be saved. */
  const saveDraft = (): boolean => {
    if (!tool || !draft) return true;
    const requests = readRequests();
    if (saveBlockers(draft, requests).length > 0) return false;
    updateTool(tidyTool(draft, requests));
    dropDraft(tool.id);
    return true;
  };

  /** Runs `go` now, or after asking what to do with unsaved Build edits. */
  const guarded = (go: () => void) => {
    if (dirtyRef.current) setLeaving({ go });
    else go();
  };

  const toolRef = useRef<Tool | null>(null);
  const refreshRecents = useCallback((toolId: string) => {
    listLookups(toolId)
      .then((list) => {
        if (toolRef.current?.id === toolId) setRecents(list);
      })
      .catch(() => setRecents([]));
  }, []);

  const lookUp = useCallback(
    async (t: Tool) => {
      const requests = readRequests();
      setFindRequest(() => requests);
      const envs = loadEnvironments();
      const env = envs.find((e) => e.id === t.settings.environmentId) ?? null;
      const s = registry.get(t.id);
      const record = await s.lookup(t, { findRequest: requests, envVars: environmentVars(env), environmentName: env?.name, send: sendRequest, scripts: scripts.run });
      if (record) {
        refreshRecents(t.id);
        // The status bar marks a lookup with problems that finished while another section was on screen.
        const failed = record.results.filter((r) => {
          const k = callView({ result: r, sending: false, lookingUp: false }).kind;
          return k === "http-error" || k === "network-error";
        }).length;
        setSectionStatus("tools", { failed, unseen: failed > 0 && !activeRef.current });
      }
    },
    [registry, scripts, refreshRecents],
  );
  /** Run with sample: the same lookup, on the draft, answering to Build mode's own session. Nothing is saved to history. */
  const runSample = useCallback(
    async (t: Tool) => {
      const requests = readRequests();
      setFindRequest(() => requests);
      const envs = loadEnvironments();
      const env = envs.find((e) => e.id === t.settings.environmentId) ?? null;
      await buildRegistry.get(t.id).lookup(t, { findRequest: requests, envVars: environmentVars(env), environmentName: env?.name, send: sendRequest, scripts: scripts.run, save: async () => {} });
    },
    [buildRegistry, scripts],
  );
  /** Asks before an Action button sends: on a coloured environment, or when the block has confirm text. */
  const askToConfirm = useCallback((t: Tool, callId: string, guard: { name: string; cssColor: string } | null): Promise<boolean> => {
    const call = t.calls.find((c) => c.id === callId);
    const block = t.blocks.find((b) => b.type === "action" && b.callId === callId);
    const line = requestLine(call ? readRequests()(call.requestId) : null);
    return new Promise<boolean>((resolve) =>
      setAsking({ action: block?.title || call?.name || "Action", request: line ? `${line.method} ${line.path}` : "", guard, text: block?.text?.trim() || undefined, answer: resolve }),
    );
  }, []);
  const answerAsk = (ok: boolean) => {
    asking?.answer(ok);
    setAsking(null);
  };
  /** An Action button: runs the write call with the answers on screen. Never part of Look up. */
  const runAction = useCallback(
    async (s: ToolSession, t: Tool, callId: string) => {
      const requests = readRequests();
      const env = loadEnvironments().find((e) => e.id === t.settings.environmentId) ?? null;
      const block = t.blocks.find((b) => b.type === "action" && b.callId === callId);
      await s.runAction(
        t,
        callId,
        { findRequest: requests, envVars: environmentVars(env), environmentName: env?.name, send: sendRequest, scripts: scripts.run, environment: env, confirm: (guard) => askToConfirm(t, callId, guard ? { name: guard.name, cssColor: guard.cssColor } : null) },
        !!block?.text?.trim(),
      );
    },
    [scripts, askToConfirm],
  );
  /** Retry on one call: only that call when nothing reads its answer, else the whole lookup so what depends on it is refreshed. */
  const retry = async (s: ToolSession, t: Tool, callId: string, whole: () => void) => {
    const requests = readRequests();
    if (!canRetryAlone(t, callId, requests)) return whole();
    const env = loadEnvironments().find((e) => e.id === t.settings.environmentId) ?? null;
    await s.retryCall(t, callId, { findRequest: requests, envVars: environmentVars(env), environmentName: env?.name, send: sendRequest, scripts: scripts.run });
  };
  const lookUpRef = useRef(lookUp);
  lookUpRef.current = lookUp;

  // Opening a tool shows its latest saved lookup without sending anything (unless the tool asks to run on open).
  const toolId = tool?.id ?? null;
  const runOnOpen = tool?.settings.runOnOpen ?? false;
  toolRef.current = tool;
  useEffect(() => {
    if (!toolId) {
      setRecents([]);
      return;
    }
    let on = true;
    setRecents([]);
    listLookups(toolId)
      .then((list) => {
        if (!on) return;
        setRecents(list);
        const s = registry.get(toolId);
        const st = s.getState();
        if (st.loaded) return;
        s.markLoaded();
        if (st.running || Object.keys(st.results).length > 0) return;
        const t = toolRef.current;
        if (runOnOpen && t) void lookUpRef.current(t);
        else if (list[0]) s.show(list[0]);
      })
      .catch(() => on && registry.get(toolId).markLoaded());
    return () => {
      on = false;
    };
  }, [toolId, registry, runOnOpen]);

  const openTool = (id: string) => {
    if (id !== openToolId) guarded(() => setOpenToolId(id));
  };
  const switchMode = (m: ToolsMode) => {
    if (m === mode) return;
    if (m === "use") guarded(() => setMode(m));
    else setMode(m);
  };

  const createTool = () =>
    guarded(() => {
      const t = newTool();
      setTools((list) => [...list, t]);
      setOpenToolId(t.id);
      // A new tool has nothing to show yet; Build is where it starts.
      setMode("build");
    });

  const deleteTool = (target: Tool) => {
    const taken = removeById(tools, target.id);
    if (!taken) return;
    registry.drop(target.id);
    buildRegistry.drop(target.id);
    dropDraft(target.id);
    setTools(taken.list);
    setOpenToolId(null);
    toast.show({
      message: `Deleted the tool "${target.name || "(unnamed)"}"`,
      onUndo: () => {
        setTools((list) => reinsert(list, taken.item, taken.index));
        setOpenToolId(taken.item.id);
      },
      // Its saved lookups go when the Undo time has passed.
      onExpire: () => void clearLookups(target.id),
    });
  };

  /** Settings changed outside Build (the top bar's environment, the sidebar's "keep recent lookups") apply to the draft too, so Save does not undo them. */
  const patchSettings = (patch: Partial<Tool["settings"]>) => {
    if (!tool) return;
    updateTool({ ...tool, settings: { ...tool.settings, ...patch } });
    if (draft) editDraft({ ...draft, settings: { ...draft.settings, ...patch } });
  };
  const changeEnvironment = (id: string | null) => patchSettings({ environmentId: id });

  /** Edits made in the Variables panel go straight to storage, where Requests and the other sections read them. */
  const editEnvironments = useCallback((envs: Environment[]) => {
    setEnvironments(envs);
    saveEnvironments(envs);
  }, []);

  /** Save as HTML: the answers on screen as a page to send. Secret values are masked like in history and reports. */
  const saveHtml = async (t: Tool) => {
    const st = registry.get(t.id).getState();
    const inputs = st.viewing?.inputs ?? st.inputs;
    try {
      const html = toToolSnapshot({
        tool: t,
        results: st.results,
        inputs,
        findRequest: readRequests(),
        environmentName: st.viewing ? st.viewing.environmentName : environments.find((e) => e.id === t.settings.environmentId)?.name,
        at: st.startedAt ?? undefined,
        secrets: storedSecrets(),
      });
      const result = await saveTextFile(snapshotFileName(t, inputs), html, "HTML page", "html");
      if (result.saved) setNotice(result.path ? `Saved to ${result.path}` : "Page downloaded.");
    } catch (e) {
      setNotice(`Could not save the page: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Export writes the saved tools (unsaved Build edits are not in the file), with the saved requests they use. */
  const exportTools = async (list: Tool[]) => {
    try {
      const collections = cleanCollections(load(COLLECTIONS_KEY, []));
      const fileName = list.length === 1 ? `${list[0].name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "tool"}.tool.json` : "rest-runner-tools.json";
      const result = await saveTextFile(fileName, toToolsFile(list, collections), "REST Runner tools", "json");
      if (result.saved) setNotice(result.path ? `Exported to ${result.path}` : "Export downloaded.");
    } catch (e) {
      setNotice(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Import replaces a tool with the same id and the saved requests it uses. A replaced tool's unsaved Build edits are dropped: they were made against the old one. */
  const importTools = async (file: File) => {
    try {
      const result = importToolsFile(await file.text(), { tools, collections: cleanCollections(load(COLLECTIONS_KEY, [])) });
      if (result.counts.requests[0] + result.counts.requests[1] > 0) {
        if (!save(COLLECTIONS_KEY, result.collections)) throw new Error("local storage is full");
        shell.onDataChanged(["collections"]);
      }
      setTools(result.tools);
      result.replacedIds.forEach((id) => dropDraft(id));
      setFindRequest(() => readRequests());
      setNotice(describeToolsImport(file.name, result.counts));
    } catch (e) {
      setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast.show({ message: "Copied" }))
      .catch(() => setNotice("Could not copy."));
  };

  /** Dev builds only: puts the example requests in a collection and adds the example tool. */
  const loadExample = () => guarded(addExample);
  const addExample = () => {
    const collections = cleanCollections(load(COLLECTIONS_KEY, []));
    if (!collections.some((c) => c.name === SAMPLE_COLLECTION_NAME)) {
      save(COLLECTIONS_KEY, [...collections, sampleCollection()]);
      shell.onDataChanged(["collections"]);
    }
    setFindRequest(() => readRequests());
    const example = sampleTool();
    setTools((list) => (list.some((t) => t.id === example.id) ? list : [...list, example]));
    setOpenToolId(example.id);
    setMode("use");
  };

  // Leaving the section (or closing the window) with unsaved Build edits asks first.
  useEffect(() => {
    setLeaveGuard("tools", (proceed) => {
      if (!dirtyRef.current) return true;
      setLeaving({ go: proceed });
      return false;
    });
    return () => setLeaveGuard("tools", null);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const createToolRef = useRef(createTool);
  createToolRef.current = createTool;
  const guardedRef = useRef(guarded);
  guardedRef.current = guarded;
  const lastCommand = useRef<number | null>(null);
  useEffect(() => {
    if (!command || lastCommand.current === command.nonce) return;
    lastCommand.current = command.nonce;
    if (command.type === "new-tool") {
      createToolRef.current();
      return;
    }
    if (command.type === "open" && command.item.kind === "tool") {
      const id = command.item.id;
      if (toolsRef.current.some((t) => t.id === id))
        guardedRef.current(() => {
          setOpenToolId(id);
          setMode("use");
        });
      return;
    }
    if (command.type === "reload") {
      const fresh = loadTools();
      setTools(fresh);
      // Another section wrote tools (an import). Unsaved Build edits are kept only for tools that did not change.
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => JSON.stringify(toolsRef.current.find((t) => t.id === id)) === JSON.stringify(fresh.find((t) => t.id === id)))));
      setEnvironments(loadEnvironments());
      setFindRequest(() => readRequests());
    }
  }, [command]);

  const modeSwitch = tool ? (
    <div className="segmented tools-mode" role="radiogroup" aria-label="Tool mode">
      {(["use", "build"] as const).map((m) => (
        <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => switchMode(m)}>
          {m === "use" ? "Use" : "Build"}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="mode tools-mode-root">
      <TopBar
        mode="tools"
        onQuickOpen={shell.onQuickOpen}
        searchPlaceholder="Jump to a request, example, run or history…"
        switcher={
          tool ? (
            <>
              <TitleSwitcher noun="Tools" title={tool.name} items={tools.map((t) => ({ id: t.id, name: t.name }))} activeId={openToolId} onOpen={openTool} onNew={createTool} />
              {modeSwitch}
            </>
          ) : undefined
        }
        environments={environments}
        activeEnvId={tool?.settings.environmentId ?? null}
        onEnvChange={changeEnvironment}
        envTitle="Each tool keeps its own environment. Environments are edited in Requests mode."
      />
      <div className={`tools-layout ${navCollapsed ? "nav-collapsed" : ""}`}>
        <ToolsSidebar
          collapsed={navCollapsed}
          onToggleCollapsed={toggleNav}
          tools={tools}
          activeToolId={openToolId && tool ? openToolId : null}
          onOpenTool={openTool}
          onNewTool={createTool}
          runningToolIds={runningIds}
          recents={recents}
          activeRecordId={state.recordId}
          onOpenRecord={(r) =>
            guarded(() => {
              setMode("use");
              session.show(r);
            })
          }
          onClearHistory={() => {
            if (!tool) return;
            void clearLookups(tool.id).then(() => setRecents([]));
          }}
          onExport={() => void exportTools(tools)}
          onImport={(f) => void importTools(f)}
          keepsHistory={tool?.settings.keepHistory ?? true}
          onKeepHistory={(keep) => patchSettings({ keepHistory: keep })}
        />
        {tool ? (
          <div className="tool-pane">
            <div className="tool-tab-actions">
              {notice && (
                <span className="small notice" role="status" title={notice}>
                  {notice}
                </span>
              )}
              <OverflowMenu label="Tool actions" items={[{ label: "Export tool", icon: "⇪", onSelect: () => void exportTools([tool]), title: "Save this tool, with the saved requests it uses, to a file. Unsaved Build edits are not included." }, { label: "Delete tool", icon: <TrashIcon />, onSelect: () => deleteTool(tool), danger: true, disabled: state.running, title: state.running ? "Stop the lookup first" : "Its recent lookups are removed too" }]} />
            </div>
            {mode === "build" ? (
              <ToolBuild
                tool={draft ?? tool}
                dirty={dirty}
                findRequest={findRequest}
                environments={environments}
                state={buildState}
                onChange={editDraft}
                onSave={() => void saveDraft()}
                onDiscard={() => dropDraft(tool.id)}
                onRunSample={(t) => void runSample(t)}
                onStop={() => buildSession.stop()}
                actions={{
                  onInput: (name, value) => buildSession.setInput(name, value),
                  onOpenRequest: (id) => guarded(() => shell.onOpenRequest(id)),
                  onCopy: copy,
                  onPick: (callId, index) => buildSession.choosePick(callId, index),
                  onRetry: (callId) => void retry(buildSession, draft ?? tool, callId, () => void runSample(draft ?? tool)),
                  onRunAction: (callId) => void runAction(buildSession, draft ?? tool, callId),
                  guard,
                  retryAlone: (callId) => canRetryAlone(draft ?? tool, callId, findRequest),
                }}
              />
            ) : (
              <ToolUse
                tool={tool}
                state={state}
                findRequest={findRequest}
                environment={environment}
                problems={problems}
                onLookup={() => void lookUp(tool)}
                onStop={() => session.stop()}
                onCopyAll={() => copy(lookupAsText(tool, state.results, findRequest))}
                onSaveHtml={() => void saveHtml(tool)}
                actions={{
                  onInput: (name, value) => session.setInput(name, value),
                  // Retry sends just that call when nothing reads its answer; otherwise it runs the whole lookup again.
                  onRetry: (callId) => void retry(session, tool, callId, () => void lookUp(tool)),
                  onRunAction: (callId) => void runAction(session, tool, callId),
                  guard,
                  retryAlone: (callId) => canRetryAlone(tool, callId, findRequest),
                  onOpenRequest: shell.onOpenRequest,
                  onCopy: copy,
                  onPick: (callId, index) => session.choosePick(callId, index),
                }}
              />
            )}
          </div>
        ) : (
          <main className="suite-doc testing-empty">
            <div>
              <h2>Tools</h2>
              <p className="muted">A tool is a small lookup page. Type an ID, press Look up, and see the answers from several saved requests side by side, each filling in as it arrives.</p>
              {notice && <p className="small notice">{notice}</p>}
              <button className="send" onClick={createTool}>
                Create a tool
              </button>
              {import.meta.env.DEV && (
                <p className="small muted tools-dev">
                  <button className="link-btn" onClick={loadExample} title="Development builds only: adds the Subscriber 360 example requests (to a collection) and tool">
                    Load the Subscriber 360 example (dev build only)
                  </button>
                </p>
              )}
            </div>
          </main>
        )}
      </div>
      {leaving && tool && (
        <UnsavedDialog
          toolName={draft?.name ?? tool.name}
          blocked={draft ? saveBlockers(draft, findRequest)[0]?.message : undefined}
          onCancel={() => setLeaving(null)}
          onDiscard={() => {
            dropDraft(tool.id);
            const go = leaving.go;
            setLeaving(null);
            go();
          }}
          onSave={() => {
            if (!saveDraft()) return;
            const go = leaving.go;
            setLeaving(null);
            go();
          }}
        />
      )}
      {asking && <ConfirmActionDialog action={asking.action} request={asking.request} guard={asking.guard} text={asking.text} onConfirm={() => answerAsk(true)} onCancel={() => answerAsk(false)} />}
      {shell.section === "tools" && tool && (
        <SectionVariablesPanel
          environments={environments}
          activeEnvId={tool.settings.environmentId}
          setEnvironments={editEnvironments}
          setActiveEnvId={changeEnvironment}
          used={environmentNames(tool, findRequest)}
          inputs={tool.inputs.map((i) => i.name)}
          scope="This tool"
          onEditEnvironments={shell.onEditEnvironments}
        />
      )}
    </div>
  );
}
