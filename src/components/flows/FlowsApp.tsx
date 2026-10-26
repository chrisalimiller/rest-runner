import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cleanCollections } from "../../lib/collections";
import { environmentVars, type Environment } from "../../lib/environments";
import { FlowNotRunnableError, runFlow } from "../../lib/flows/engine";
import { describeImport, importFlowsFile, toFlowsFile } from "../../lib/flows/flowFile";
import { deleteFlowRun, getFlowRun, listFlowRuns, saveFlowRun } from "../../lib/flows/flowRunStore";
import { loadFlows, newFlow, nodeLabel, saveFlows } from "../../lib/flows/flows";
import { readFlowItems, type FlowItems } from "../../lib/flows/items";
import { decide, nextDueAfter, type ScheduleState } from "../../lib/flows/schedule";
import type { Flow, FlowNode, FlowRun, FlowRunSummary } from "../../lib/flows/types";
import { hasErrors, validateFlow } from "../../lib/flows/validate";
import { sendRequest } from "../../lib/http";
import { newId } from "../../lib/ids";
import { saveTextFile } from "../../lib/saveFile";
import { load, save } from "../../lib/storage";
import { createWorkerScriptRunner } from "../../lib/testing/scriptRunner";
import type { ShellCommand, ShellProps } from "../../Root";
import { TopBar } from "../shell/TopBar";
import { FlowCanvas, type NodeRunState } from "./FlowCanvas";
import { FlowRunPanel, type FlowRunView } from "./FlowRunPanel";
import { FlowRunReport } from "./FlowRunReport";
import { FlowsSidebar, type ScheduleInfo } from "./FlowsSidebar";
import { NodeSettings } from "./NodeSettings";
import "./flows.css";

const OPEN_FLOW_KEY = "rest-runner.flow-open";
const FLOW_ENV_KEY = "rest-runner.flow-environment";
const SCHEDULE_STATE_KEY = "rest-runner.flow-schedules";
const ENVIRONMENTS_KEY = "rest-runner.environments";
const SUITES_KEY = "rest-runner.test-suites";
const COLLECTIONS_KEY = "rest-runner.collections";
/** How often the scheduler looks for runs that came due. */
const SCHEDULE_TICK_MS = 15_000;

interface Props {
  /** True when Flows is on screen. */
  active: boolean;
  shell: ShellProps;
  command: ShellCommand | null;
}

/** Scheduler memory per Schedule step id. `key` is the schedule it was worked out for; a changed schedule starts over. */
type SchedulesState = Record<string, ScheduleState & { key: string }>;

function viewOf(run: FlowRun): FlowRunView {
  return {
    flowId: run.flowId,
    running: false,
    steps: run.stepList,
    runningNodeIds: [],
    startedAt: Date.parse(run.startedAt),
    finishedAt: Date.parse(run.finishedAt),
    end: run.end,
    endReason: run.endReason,
    passedSteps: run.passedSteps,
    failedSteps: run.failedSteps,
    runId: run.id,
  };
}

function runStateOf(view: FlowRunView | null): Map<string, NodeRunState> {
  const map = new Map<string, NodeRunState>();
  if (!view) return map;
  for (const s of [...view.steps].sort((a, b) => a.index - b.index)) map.set(s.nodeId, { status: s.status, runs: (map.get(s.nodeId)?.runs ?? 0) + 1 });
  if (view.running) for (const id of view.runningNodeIds) map.set(id, { status: "running", runs: map.get(id)?.runs ?? 0 });
  return map;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** Flows mode: chain test cases, suites and saved requests on a canvas and run them as one. */
export function FlowsApp({ active, shell, command }: Props) {
  const [flows, setFlows] = useState<Flow[]>(loadFlows);
  const [openFlowId, setOpenFlowId] = useState<string | null>(() => load(OPEN_FLOW_KEY, null));
  const [environments, setEnvironments] = useState<Environment[]>(() => load(ENVIRONMENTS_KEY, []));
  const [envId, setEnvId] = useState<string | null>(() => load(FLOW_ENV_KEY, null));
  const [items, setItems] = useState<FlowItems>(readFlowItems);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deselectNonce, setDeselectNonce] = useState(0);
  const closeSettings = () => {
    setSelectedId(null);
    setDeselectNonce((n) => n + 1);
  };
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  /** Runs in progress (or just finished), per flow. Several flows can run at once. */
  const [lives, setLives] = useState<Record<string, FlowRunView>>({});
  const [runs, setRuns] = useState<FlowRunSummary[]>([]);
  /** The saved run whose report is open full width. */
  const [reportId, setReportId] = useState<string | null>(null);
  /** A saved run shown on the canvas: its flow as it was, read-only. */
  const [viewed, setViewed] = useState<FlowRun | null>(null);
  const [latest, setLatest] = useState<FlowRun | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<SchedulesState>(() => load(SCHEDULE_STATE_KEY, {}));
  const aborts = useRef(new Map<string, AbortController>());
  const scripts = useMemo(() => createWorkerScriptRunner(), []);
  useEffect(() => () => scripts.dispose(), [scripts]);

  useEffect(() => {
    if (!saveFlows(flows)) setNotice("Could not save flows: local storage is full.");
  }, [flows]);
  useEffect(() => {
    save(OPEN_FLOW_KEY, openFlowId);
  }, [openFlowId]);
  useEffect(() => {
    save(FLOW_ENV_KEY, envId);
  }, [envId]);
  useEffect(() => {
    save(SCHEDULE_STATE_KEY, schedules);
  }, [schedules]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Suites, requests and environments are edited in the other modes; pick up changes whenever Flows is shown.
  useEffect(() => {
    if (!active) return;
    setEnvironments(load(ENVIRONMENTS_KEY, []));
    setItems(readFlowItems());
  }, [active]);

  const refreshRuns = useCallback(() => {
    listFlowRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);
  useEffect(refreshRuns, [refreshRuns]);

  const flow = viewed ? viewed.flow : (flows.find((f) => f.id === openFlowId) ?? null);
  const readOnly = viewed !== null;
  const problems = useMemo(() => (flow && !readOnly ? validateFlow(flow, items.suites, items.findRequest) : []), [flow, items, readOnly]);
  const latestRunId = flow && !readOnly ? (runs.find((r) => r.flowId === flow.id)?.id ?? null) : null;
  const live = flow ? (lives[flow.id] ?? null) : null;

  useEffect(() => {
    let on = true;
    if (!latestRunId) {
      setLatest(null);
      return;
    }
    getFlowRun(latestRunId)
      .then((r) => on && setLatest(r ?? null))
      .catch(() => on && setLatest(null));
    return () => {
      on = false;
    };
  }, [latestRunId]);

  const shownRun: FlowRunView | null = useMemo(() => {
    if (!flow) return null;
    if (viewed) return viewOf(viewed);
    if (live && (live.running || !live.runId || live.runId !== latest?.id)) return live;
    if (latest && latest.flowId === flow.id) return viewOf(latest);
    return null;
  }, [flow, viewed, live, latest]);
  const runState = useMemo(() => runStateOf(shownRun), [shownRun]);

  const updateFlow = useCallback((next: Flow) => setFlows((list) => list.map((f) => (f.id === next.id ? next : f))), []);
  const updateNode = (node: FlowNode) => flow && updateFlow({ ...flow, nodes: flow.nodes.map((n) => (n.id === node.id ? node : n)) });
  const deleteNode = (id: string) => {
    if (!flow) return;
    updateFlow({ ...flow, nodes: flow.nodes.filter((n) => n.id !== id), edges: flow.edges.filter((e) => e.source !== id && e.target !== id) });
    setSelectedId(null);
  };

  const openFlow = (id: string) => {
    setViewed(null);
    setReportId(null);
    setOpenFlowId(id);
    setSelectedId(null);
  };

  const createFlow = () => {
    const f = newFlow();
    setFlows((list) => [...list, f]);
    openFlow(f.id);
  };

  const setLive = (flowId: string, fn: (l: FlowRunView) => FlowRunView) =>
    setLives((all) => (all[flowId] ? { ...all, [flowId]: fn(all[flowId]) } : all));

  /** Runs a flow from Start (or a Schedule step). Several flows can run at once, but one flow only once at a time. */
  const run = async (f: Flow, entryNodeId?: string) => {
    if (aborts.current.has(f.id)) return;
    const fresh = readFlowItems();
    setItems(fresh);
    // Read environments now: a scheduled run can start while another mode is open.
    const envs = load<Environment[]>(ENVIRONMENTS_KEY, []);
    const runEnv = envs.find((e) => e.id === envIdRef.current) ?? null;
    const controller = new AbortController();
    aborts.current.set(f.id, controller);
    setLives((all) => ({ ...all, [f.id]: { flowId: f.id, running: true, steps: [], runningNodeIds: [], startedAt: Date.now() } }));
    try {
      const result = await runFlow(f, {
        suites: fresh.suites,
        findRequest: fresh.findRequest,
        envVars: environmentVars(runEnv),
        environmentName: runEnv?.name,
        send: sendRequest,
        scripts: scripts.run,
        signal: controller.signal,
        entryNodeId,
        trigger: entryNodeId ?? "manual",
        onStepStart: (nodeId) => setLive(f.id, (l) => ({ ...l, runningNodeIds: [...l.runningNodeIds, nodeId] })),
        onStep: (step) =>
          setLive(f.id, (l) => {
            const i = l.runningNodeIds.indexOf(step.nodeId);
            return { ...l, steps: [...l.steps, { ...step }], runningNodeIds: i === -1 ? l.runningNodeIds : l.runningNodeIds.filter((_, j) => j !== i) };
          }),
      });
      setLive(f.id, (l) => ({
        ...l,
        running: false,
        runningNodeIds: [],
        finishedAt: Date.parse(result.finishedAt),
        end: result.end,
        endReason: result.endReason,
        passedSteps: result.passedSteps,
        failedSteps: result.failedSteps,
      }));
      try {
        await saveFlowRun(result);
        setLive(f.id, (l) => ({ ...l, runId: result.id }));
        refreshRuns();
      } catch (e) {
        setLive(f.id, (l) => ({ ...l, saveError: e instanceof Error ? e.message : String(e) }));
      }
    } catch (e) {
      const message = e instanceof FlowNotRunnableError ? `The flow can't start: ${e.message}` : `The flow stopped with an error: ${e instanceof Error ? e.message : String(e)}`;
      setLive(f.id, (l) => ({ ...l, running: false, runningNodeIds: [], error: message }));
    } finally {
      aborts.current.delete(f.id);
    }
  };

  // The scheduler reads the latest values through refs, since it runs on a timer.
  const envIdRef = useRef(envId);
  envIdRef.current = envId;
  const flowsRef = useRef(flows);
  flowsRef.current = flows;
  const runRef = useRef(run);
  runRef.current = run;
  const appStartedAt = useRef(new Date());

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const fresh = readFlowItems();
      setSchedules((prev) => {
        const next: SchedulesState = {};
        const toRun: [Flow, string][] = [];
        for (const f of flowsRef.current) {
          for (const n of f.nodes) {
            if (n.type !== "schedule" || !n.enabled) continue;
            const key = JSON.stringify(n.schedule);
            const state = prev[n.id]?.key === key ? prev[n.id] : undefined;
            const d = decide(n.schedule, state, now, appStartedAt.current, aborts.current.has(f.id));
            if (d.action === "none") {
              if (state) next[n.id] = state;
            } else if (d.action === "init") {
              next[n.id] = { key, handledDue: d.due };
            } else if (d.action === "skip") {
              next[n.id] = { ...state, key, handledDue: d.due, skipped: { due: d.due, reason: d.reason } };
            } else {
              const blocked = hasErrors(validateFlow(f, fresh.suites, fresh.findRequest, { entryNodeId: n.id }));
              next[n.id] = blocked
                ? { ...state, key, handledDue: d.due, skipped: { due: d.due, reason: "the flow has problems to fix" } }
                : { ...state, key, handledDue: d.due, ranDue: d.due };
              if (!blocked) toRun.push([f, n.id]);
            }
          }
        }
        // Start runs after this update, outside the state updater.
        if (toRun.length) setTimeout(() => toRun.forEach(([f, id]) => void runRef.current(f, id)), 0);
        const same = Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => JSON.stringify(prev[k]) === JSON.stringify(v));
        return same ? prev : next;
      });
    };
    tick();
    const t = setInterval(tick, SCHEDULE_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const scheduleInfo = useMemo(() => {
    const out: Record<string, ScheduleInfo> = {};
    const now = new Date();
    for (const f of flows) {
      let next: Date | null = null;
      let skipped: { due: string; reason: string } | undefined;
      for (const n of f.nodes) {
        if (n.type !== "schedule" || !n.enabled) continue;
        const due = nextDueAfter(n.schedule, now);
        if (due && (!next || due < next)) next = due;
        const s = schedules[n.id]?.skipped;
        if (s && (!skipped || s.due > skipped.due)) skipped = s;
      }
      if (next || skipped) {
        out[f.id] = {
          next: next ? timeLabel(next.toISOString()) : undefined,
          skipped: skipped ? `Skipped the ${timeLabel(skipped.due)} run: ${skipped.reason}.` : undefined,
        };
      }
    }
    return out;
    // Recomputed when the scheduler state changes, which happens at least on every due time.
  }, [flows, schedules]);

  const openRunReport = (id: string) => {
    setViewed(null);
    setSelectedId(null);
    setReportId(id);
  };

  const showRunOnCanvas = (r: FlowRun) => {
    setReportId(null);
    setSelectedId(null);
    setViewed(r);
  };

  const exportFlows = async (list: Flow[]) => {
    try {
      const collections = cleanCollections(load(COLLECTIONS_KEY, []));
      const fileName = list.length === 1 ? `${list[0].name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "flow"}.flow.json` : "rest-runner-flows.json";
      const result = await saveTextFile(fileName, toFlowsFile(list, readFlowItems().suites, collections), "REST Runner flows", "json");
      if (result.saved) setNotice(result.path ? `Exported to ${result.path}` : "Export downloaded.");
    } catch (e) {
      setNotice(`Could not export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const importFlows = async (file: File) => {
    try {
      const fresh = readFlowItems();
      const result = importFlowsFile(await file.text(), { flows, suites: fresh.suites, collections: cleanCollections(load(COLLECTIONS_KEY, [])) });
      setFlows(result.flows);
      const wrote: ("suites" | "collections")[] = [];
      if (result.counts.suites[0] + result.counts.suites[1] > 0) {
        if (!save(SUITES_KEY, result.suites)) throw new Error("local storage is full");
        wrote.push("suites");
      }
      if (result.counts.requests[0] + result.counts.requests[1] > 0) {
        if (!save(COLLECTIONS_KEY, result.collections)) throw new Error("local storage is full");
        wrote.push("collections");
      }
      if (wrote.length) shell.onDataChanged(wrote);
      setItems(readFlowItems());
      setNotice(describeImport(file.name, result.counts));
    } catch (e) {
      setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const lastCommand = useRef<number | null>(null);
  useEffect(() => {
    if (!command || lastCommand.current === command.nonce) return;
    lastCommand.current = command.nonce;
    if (command.type !== "open") return;
    const item = command.item;
    if (item.kind === "flow") {
      if (flows.some((f) => f.id === item.id)) openFlow(item.id);
      else setNotice("That flow no longer exists.");
    } else if (item.kind === "flow-run") {
      openRunReport(item.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const runningIds = Object.values(lives)
    .filter((l) => l.running)
    .map((l) => l.flowId);
  const flowRunning = !!flow && runningIds.includes(flow.id);
  const selected = flow && selectedId ? (flow.nodes.find((n) => n.id === selectedId) ?? null) : null;
  const labelFor = (id: string) => {
    const n = flow?.nodes.find((x) => x.id === id);
    return n ? nodeLabel(n, items.suites, items.findRequest) : "";
  };
  const focusNode = (id: string) => setFocus({ id, nonce: Date.now() });
  const hasStart = !!flow?.nodes.some((n) => n.type === "start");
  const onlySchedule = !hasStart ? flow?.nodes.filter((n) => n.type === "schedule") : undefined;

  return (
    <div className="mode flows-mode">
      <TopBar
        mode="flows"
        onMode={shell.onMode}
        onQuickOpen={shell.onQuickOpen}
        searchPlaceholder="Jump to a flow, flow run, suite or case…"
        switcher={flow && !reportId ? <span className="topbar-title" title={flow.name}>{flow.name || "(unnamed)"}</span> : undefined}
        environments={environments}
        activeEnvId={envId}
        onEnvChange={setEnvId}
        envTitle="Flows (including scheduled runs) use this environment. Environments are edited in Requests mode."
      />
      <div className={`flows-layout ${reportId ? "with-report" : ""}`}>
        <FlowsSidebar
          flows={flows}
          activeFlowId={openFlowId}
          onOpenFlow={openFlow}
          onNewFlow={createFlow}
          onExport={() => void exportFlows(flows)}
          onImport={(f) => void importFlows(f)}
          runs={runs}
          activeRunId={reportId ?? viewed?.id ?? null}
          onOpenRun={openRunReport}
          runningFlowIds={runningIds}
          scheduleInfo={scheduleInfo}
        />
        {reportId ? (
          <main className="workspace full-view">
            <FlowRunReport
              runId={reportId}
              onBack={() => setReportId(null)}
              onDelete={(id) => {
                void deleteFlowRun(id).finally(refreshRuns);
                setReportId(null);
              }}
              onShowCanvas={showRunOnCanvas}
            />
          </main>
        ) : flow ? (
          <>
            <main className="flow-main">
              <div className="flow-head">
                {readOnly ? (
                  <div className="flow-viewing">
                    <span>
                      Viewing the run of <strong>{viewed.flowName}</strong> from {new Date(viewed.startedAt).toLocaleString()}, as the flow was then.
                    </span>
                    <button className="secondary" onClick={() => openRunReport(viewed.id)}>
                      Open report
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setViewed(null);
                        if (flows.some((f) => f.id === viewed.flowId)) setOpenFlowId(viewed.flowId);
                      }}
                    >
                      Back to editing
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flow-title">
                      <input className="flow-name" value={flow.name} onChange={(e) => updateFlow({ ...flow, name: e.target.value })} aria-label="Flow name" placeholder="Flow name" />
                      <input
                        className="flow-desc"
                        value={flow.description}
                        onChange={(e) => updateFlow({ ...flow, description: e.target.value })}
                        aria-label="Description"
                        placeholder="What this flow checks (optional)"
                      />
                    </div>
                    <span className="flex-gap" />
                    {notice && (
                      <span className="small notice" role="status" title={notice}>
                        {notice}
                      </span>
                    )}
                    <button className="secondary ghost" onClick={() => void exportFlows([flow])} title="Save this flow, with the suites and saved requests it runs, to a file">
                      Export
                    </button>
                    <button
                      className="secondary ghost"
                      onClick={() => {
                        const copy = { ...structuredClone(flow), id: newId(), name: `${flow.name} copy` };
                        // Schedule steps get new ids so the copy keeps its own schedule state.
                        const ids = new Map(copy.nodes.map((n) => [n.id, n.type === "schedule" ? newId() : n.id]));
                        copy.nodes = copy.nodes.map((n) => ({ ...n, id: ids.get(n.id)! }));
                        copy.edges = copy.edges.map((e) => ({ ...e, source: ids.get(e.source)!, target: ids.get(e.target)! }));
                        setFlows((list) => [...list, copy]);
                        openFlow(copy.id);
                      }}
                    >
                      Duplicate
                    </button>
                    <button
                      className="secondary ghost danger"
                      disabled={flowRunning}
                      onClick={() => {
                        if (!window.confirm(`Delete the flow "${flow.name}"? Its saved runs are kept.`)) return;
                        setFlows((list) => list.filter((f) => f.id !== flow.id));
                        setOpenFlowId(null);
                      }}
                    >
                      Delete
                    </button>
                    {flowRunning ? (
                      <button className="send cancel" onClick={() => aborts.current.get(flow.id)?.abort()}>
                        Stop
                      </button>
                    ) : (
                      <button
                        className="send"
                        onClick={() => void run(flow, onlySchedule?.length === 1 ? onlySchedule[0].id : undefined)}
                        disabled={hasErrors(problems)}
                        title={hasErrors(problems) ? "Fix the problems listed on the right first" : hasStart ? "Run the flow from its Start step" : "Run the flow from its Schedule step now"}
                      >
                        Run
                      </button>
                    )}
                  </>
                )}
              </div>
              <FlowCanvas
                flow={flow}
                items={items}
                problems={problems}
                runState={runState}
                readOnly={readOnly}
                onChange={updateFlow}
                onSelect={setSelectedId}
                focusNodeId={focus?.id ?? null}
                focusNonce={focus?.nonce ?? 0}
                deselectNonce={deselectNonce}
              />
            </main>
            {selected && !readOnly ? (
              <NodeSettings
                key={selected.id}
                node={selected}
                items={items}
                problems={problems}
                scheduleState={selected.type === "schedule" ? schedules[selected.id] : undefined}
                onChange={updateNode}
                onDelete={() => deleteNode(selected.id)}
                onClose={closeSettings}
              />
            ) : (
              <FlowRunPanel
                problems={problems}
                run={shownRun}
                labelFor={labelFor}
                onFocusNode={focusNode}
                onOpenReport={shownRun?.runId ? () => openRunReport(shownRun.runId!) : undefined}
              />
            )}
          </>
        ) : (
          <main className="suite-doc testing-empty">
            <div>
              <h2>Flows</h2>
              <p className="muted">
                Chain test cases, whole suites and saved requests on a canvas. Branch on pass or fail, run steps in parallel, loop over CSV rows, retry, and run it all at once or on a schedule.
              </p>
              {notice && <p className="small notice">{notice}</p>}
              <button className="send" onClick={createFlow}>
                Create a flow
              </button>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
