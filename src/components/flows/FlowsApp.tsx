import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { environmentVars, type Environment } from "../../lib/environments";
import { FlowNotRunnableError, runFlow } from "../../lib/flows/engine";
import { getFlowRun, listFlowRuns, saveFlowRun } from "../../lib/flows/flowRunStore";
import { loadFlows, newFlow, nodeLabel, saveFlows } from "../../lib/flows/flows";
import { readFlowItems, type FlowItems } from "../../lib/flows/items";
import type { Flow, FlowNode, FlowRun, FlowRunSummary } from "../../lib/flows/types";
import { hasErrors, validateFlow } from "../../lib/flows/validate";
import { sendRequest } from "../../lib/http";
import { newId } from "../../lib/ids";
import { load, save } from "../../lib/storage";
import { createWorkerScriptRunner } from "../../lib/testing/scriptRunner";
import type { ShellCommand, ShellProps } from "../../Root";
import { TopBar } from "../shell/TopBar";
import { FlowCanvas, type NodeRunState } from "./FlowCanvas";
import { FlowRunPanel, type FlowRunView } from "./FlowRunPanel";
import { FlowsSidebar } from "./FlowsSidebar";
import { NodeSettings } from "./NodeSettings";
import "./flows.css";

const OPEN_FLOW_KEY = "rest-runner.flow-open";
const FLOW_ENV_KEY = "rest-runner.flow-environment";
const ENVIRONMENTS_KEY = "rest-runner.environments";

interface Props {
  /** True when Flows is on screen. */
  active: boolean;
  shell: ShellProps;
  command: ShellCommand | null;
}

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

/** Flows mode: chain test cases, suites and saved requests on a canvas and run them as one. */
export function FlowsApp({ active, shell }: Props) {
  const [flows, setFlows] = useState<Flow[]>(loadFlows);
  const [openFlowId, setOpenFlowId] = useState<string | null>(() => load(OPEN_FLOW_KEY, null));
  const [environments, setEnvironments] = useState<Environment[]>(() => load(ENVIRONMENTS_KEY, []));
  const [envId, setEnvId] = useState<string | null>(() => load(FLOW_ENV_KEY, null));
  const [items, setItems] = useState<FlowItems>(readFlowItems);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [live, setLive] = useState<FlowRunView | null>(null);
  const [runs, setRuns] = useState<FlowRunSummary[]>([]);
  /** A saved run opened from the list: its flow as it was, shown read-only. */
  const [viewed, setViewed] = useState<FlowRun | null>(null);
  const [latest, setLatest] = useState<FlowRun | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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

  const env = environments.find((e) => e.id === envId) ?? null;
  const envVars = useMemo(() => environmentVars(env), [env]);
  const flow = viewed ? viewed.flow : (flows.find((f) => f.id === openFlowId) ?? null);
  const readOnly = viewed !== null;
  const problems = useMemo(() => (flow && !readOnly ? validateFlow(flow, items.suites, items.findRequest) : []), [flow, items, readOnly]);
  const latestRunId = flow && !readOnly ? (runs.find((r) => r.flowId === flow.id)?.id ?? null) : null;

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
    if (live && live.flowId === flow.id && (live.running || !live.runId || live.runId !== latest?.id)) return live;
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
    setOpenFlowId(id);
    setSelectedId(null);
  };

  const createFlow = () => {
    const f = newFlow();
    setFlows((list) => [...list, f]);
    openFlow(f.id);
  };

  const openRun = async (id: string) => {
    try {
      const r = await getFlowRun(id);
      if (!r) {
        setNotice("That run is no longer saved.");
        return;
      }
      setViewed(r);
      setSelectedId(null);
    } catch (e) {
      setNotice(`Could not open the run: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const run = async (f: Flow) => {
    if (abortRef.current) return;
    const fresh = readFlowItems();
    setItems(fresh);
    const controller = new AbortController();
    abortRef.current = controller;
    setSelectedId(null);
    setLive({ flowId: f.id, running: true, steps: [], runningNodeIds: [], startedAt: Date.now() });
    try {
      const result = await runFlow(f, {
        suites: fresh.suites,
        findRequest: fresh.findRequest,
        envVars,
        environmentName: env?.name,
        send: sendRequest,
        scripts: scripts.run,
        signal: controller.signal,
        trigger: "manual",
        onStepStart: (nodeId) => setLive((l) => (l ? { ...l, runningNodeIds: [...l.runningNodeIds, nodeId] } : l)),
        onStep: (step) =>
          setLive((l) => {
            if (!l) return l;
            const i = l.runningNodeIds.indexOf(step.nodeId);
            return { ...l, steps: [...l.steps, { ...step }], runningNodeIds: i === -1 ? l.runningNodeIds : l.runningNodeIds.filter((_, j) => j !== i) };
          }),
      });
      setLive((l) =>
        l
          ? {
              ...l,
              running: false,
              runningNodeIds: [],
              finishedAt: Date.parse(result.finishedAt),
              end: result.end,
              endReason: result.endReason,
              passedSteps: result.passedSteps,
              failedSteps: result.failedSteps,
            }
          : l,
      );
      try {
        await saveFlowRun(result);
        setLive((l) => (l && l.flowId === f.id ? { ...l, runId: result.id } : l));
        refreshRuns();
      } catch (e) {
        setLive((l) => (l ? { ...l, saveError: e instanceof Error ? e.message : String(e) } : l));
      }
    } catch (e) {
      const message = e instanceof FlowNotRunnableError ? `The flow can't start: ${e.message}` : `The flow stopped with an error: ${e instanceof Error ? e.message : String(e)}`;
      setLive((l) => (l ? { ...l, running: false, error: message } : l));
    } finally {
      abortRef.current = null;
    }
  };

  const running = !!live?.running;
  const flowRunning = running && live?.flowId === flow?.id;
  const selected = flow && selectedId ? (flow.nodes.find((n) => n.id === selectedId) ?? null) : null;
  const labelFor = (id: string) => {
    const n = flow?.nodes.find((x) => x.id === id);
    return n ? nodeLabel(n, items.suites, items.findRequest) : "";
  };
  const focusNode = (id: string) => setFocus({ id, nonce: Date.now() });

  return (
    <div className="mode flows-mode">
      <TopBar
        mode="flows"
        onMode={shell.onMode}
        onQuickOpen={shell.onQuickOpen}
        searchPlaceholder="Jump to a suite, case or request…"
        switcher={flow ? <span className="topbar-title" title={flow.name}>{flow.name || "(unnamed)"}</span> : undefined}
        environments={environments}
        activeEnvId={envId}
        onEnvChange={setEnvId}
        envTitle="Flows use this environment. Environments are edited in Requests mode."
      />
      <div className="flows-layout">
        <FlowsSidebar
          flows={flows}
          activeFlowId={openFlowId}
          onOpenFlow={openFlow}
          onNewFlow={createFlow}
          runs={runs}
          activeRunId={viewed?.id ?? null}
          onOpenRun={(id) => void openRun(id)}
          runningFlowId={running ? (live?.flowId ?? null) : null}
        />
        {flow ? (
          <>
            <main className="flow-main">
              <div className="flow-head">
                {readOnly ? (
                  <div className="flow-viewing">
                    <span>
                      Viewing the run of <strong>{viewed.flowName}</strong> from {new Date(viewed.startedAt).toLocaleString()}, as the flow was then.
                    </span>
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
                    {notice && <span className="small notice">{notice}</span>}
                    <button
                      className="secondary ghost"
                      onClick={() => {
                        const copy = { ...structuredClone(flow), id: newId(), name: `${flow.name} copy` };
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
                      <button className="send cancel" onClick={() => abortRef.current?.abort()}>
                        Stop
                      </button>
                    ) : (
                      <button
                        className="send"
                        onClick={() => void run(flow)}
                        disabled={running || hasErrors(problems)}
                        title={running ? "Another flow is running" : hasErrors(problems) ? "Fix the problems listed on the right first" : "Run the flow from its Start node"}
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
              />
            </main>
            {selected && !readOnly ? (
              <NodeSettings
                key={selected.id}
                node={selected}
                items={items}
                problems={problems}
                onChange={updateNode}
                onDelete={() => deleteNode(selected.id)}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <FlowRunPanel problems={problems} run={shownRun} labelFor={labelFor} onFocusNode={focusNode} />
            )}
          </>
        ) : (
          <main className="suite-doc testing-empty">
            <div>
              <h2>Flows</h2>
              <p className="muted">
                Chain test cases, whole suites and saved requests on a canvas. Branch on pass or fail, retry, wait and pass values from step to step, then run it all at once.
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
