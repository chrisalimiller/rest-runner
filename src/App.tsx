import { useCallback, useEffect, useRef, useState } from "react";
import { AuthEditor } from "./components/AuthEditor";
import { BatchPane } from "./components/BatchPane";
import { BodyEditor } from "./components/BodyEditor";
import { countActive, KeyValueEditor } from "./components/KeyValueEditor";
import { ResponsePane } from "./components/ResponsePane";
import { Sidebar } from "./components/Sidebar";
import { newRequest } from "./lib/defaults";
import { sendRequest } from "./lib/http";
import { newId } from "./lib/ids";
import { prepareRequest } from "./lib/request";
import { load, save } from "./lib/storage";
import { HTTP_METHODS, type HistoryEntry, type HttpMethod, type RequestDef, type SendOutcome } from "./lib/types";

type RequestTab = "params" | "auth" | "headers" | "body";
type LowerPane = "response" | "batch";

const DRAFT_KEY = "rest-runner.draft";
const HISTORY_KEY = "rest-runner.history";
const MAX_HISTORY = 50;

export default function App() {
  const [def, setDef] = useState<RequestDef>(() => load(DRAFT_KEY, newRequest()));
  const [tab, setTab] = useState<RequestTab>("params");
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [sending, setSending] = useState(false);
  const [pane, setPane] = useState<LowerPane>("response");
  const [batchRunning, setBatchRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => load(HISTORY_KEY, []));
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => save(DRAFT_KEY, def), [def]);
  useEffect(() => save(HISTORY_KEY, history), [history]);

  const patch = (p: Partial<RequestDef>) => setDef((d) => ({ ...d, ...p }));

  const send = useCallback(async () => {
    if (sending || def.url.trim() === "") return;
    setPane("response");
    const prepared = prepareRequest(def);
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
  }, [def, sending]);

  const cancel = () => abortRef.current?.abort();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void send();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  const methodAllowsBody = def.method !== "GET" && def.method !== "HEAD";
  const tabLabel = (name: string, count: number) => (count > 0 ? `${name} (${count})` : name);

  return (
    <div className="app">
      <Sidebar
        history={history}
        onNew={() => {
          setDef(newRequest());
          setOutcome(null);
        }}
        onOpen={(h) => {
          setDef(structuredClone(h.def));
          setOutcome(null);
        }}
        onClear={() => setHistory([])}
      />

      <main className="workspace">
        <input
          className="request-name"
          value={def.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-label="Request name"
        />

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
            <BatchPane def={def} onRunningChange={setBatchRunning} />
          </div>
        </section>
      </main>
    </div>
  );
}
