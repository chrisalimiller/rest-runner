import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthEditor } from "./components/AuthEditor";
import { BatchPane } from "./components/BatchPane";
import { BodyEditor } from "./components/BodyEditor";
import { EnvironmentEditor } from "./components/EnvironmentEditor";
import { countActive, KeyValueEditor } from "./components/KeyValueEditor";
import { ResponsePane } from "./components/ResponsePane";
import { RunExplorer } from "./components/RunExplorer";
import { Sidebar } from "./components/Sidebar";
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
const SAVED_KEY = "rest-runner.saved";
const ENVIRONMENTS_KEY = "rest-runner.environments";
const ACTIVE_ENV_KEY = "rest-runner.active-environment";

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
  const [saved, setSaved] = useState<RequestDef[]>(() => load(SAVED_KEY, []));
  const [environments, setEnvironments] = useState<Environment[]>(() => load(ENVIRONMENTS_KEY, []));
  const [activeEnvId, setActiveEnvId] = useState<string | null>(() => load(ACTIVE_ENV_KEY, null));
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;
  const envVars = useMemo(() => environmentVars(activeEnv), [activeEnv]);
  const savedVersion = saved.find((r) => r.id === def.id);
  const isDirty = !savedVersion || JSON.stringify(savedVersion) !== JSON.stringify(def);

  useEffect(() => save(SAVED_KEY, saved), [saved]);
  useEffect(() => save(ENVIRONMENTS_KEY, environments), [environments]);
  useEffect(() => save(ACTIVE_ENV_KEY, activeEnvId), [activeEnvId]);
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

  useEffect(() => save(DRAFT_KEY, def), [def]);
  useEffect(() => save(HISTORY_KEY, history), [history]);

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
    setSaved((list) => (list.some((r) => r.id === copy.id) ? list.map((r) => (r.id === copy.id ? copy : r)) : [...list, copy]));
    setNotice(`Saved "${copy.name}".`);
  }, [def]);

  const exportWorkspace = async () => {
    try {
      const result = await saveTextFile("rest-runner-export.json", toWorkspaceFile(saved, environments), "REST Runner export", "json");
      if (result.saved) setNotice(result.path ? `Exported to ${result.path}` : "Export downloaded.");
    } catch (e) {
      setNotice(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importWorkspace = async (file: File) => {
    try {
      const result = importWorkspaceFile(await file.text(), saved, environments);
      setSaved(result.savedRequests);
      setEnvironments(result.environments);
      setNotice(`Imported ${file.name}: ${result.added} added, ${result.replaced} updated.`);
    } catch (e) {
      setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || openRun !== null || showEnvEditor) return;
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
  }, [send, saveCurrent, openRun, showEnvEditor, active]);

  const methodAllowsBody = def.method !== "GET" && def.method !== "HEAD";
  const tabLabel = (name: string, count: number) => (count > 0 ? `${name} (${count})` : name);

  return (
    <div className="app">
      <Sidebar
        saved={saved}
        activeRequestId={def.id}
        onOpenSaved={(r) => {
          setDef(structuredClone(r));
          setOutcome(null);
          setOpenRun(null);
        }}
        onDeleteSaved={(id) => setSaved((list) => list.filter((r) => r.id !== id))}
        onExport={() => void exportWorkspace()}
        onImport={(f) => void importWorkspace(f)}
        history={history}
        runs={runs}
        activeRunId={openRun}
        onOpenRun={setOpenRun}
        onNew={() => {
          setDef(newRequest());
          setOutcome(null);
          setOpenRun(null);
        }}
        onOpen={(h) => {
          setDef(structuredClone(h.def));
          setOutcome(null);
          setOpenRun(null);
        }}
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
          <input
            className="request-name"
            value={def.name}
            onChange={(e) => patch({ name: e.target.value })}
            aria-label="Request name"
          />
          <span className="muted small save-state">{savedVersion ? (isDirty ? "Unsaved changes" : "Saved") : "Not saved"}</span>
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
            <ResponsePane outcome={outcome} sending={sending} />
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
