import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newEdge, newNode, NODE_TYPE_LABELS, nodeLabel } from "../../lib/flows/flows";
import { tidyFlow } from "../../lib/flows/layout";
import { chooseView, FIT_PADDING, MIN_ZOOM, READABLE_ZOOM } from "../../lib/flows/view";
import { nodeDetail, type FlowItems } from "../../lib/flows/items";
import { MULTI_WIRE_OUTPUTS, type Flow, type FlowNode, type FlowNodeType, type FlowOutput } from "../../lib/flows/types";
import type { FlowProblem } from "../../lib/flows/validate";
import { CanvasActions, NoteNodeView, StepNodeView, type CanvasStatus, type StepData } from "./FlowNodeView";

const NODE_TYPES = { step: StepNodeView, note: NoteNodeView };

/** What the palette offers, in order. */
const PALETTE: { type: FlowNodeType; hint: string }[] = [
  { type: "start", hint: "Where a run begins" },
  { type: "schedule", hint: "Run the flow on a timer while the app is open" },
  { type: "run-case", hint: "One test case from a suite" },
  { type: "run-suite", hint: "A whole suite, with its CSV" },
  { type: "run-request", hint: "A saved request and its scripts" },
  { type: "if", hint: "Branch on a value or the last result" },
  { type: "parallel", hint: "Run several branches at the same time" },
  { type: "join", hint: "Wait for every parallel branch" },
  { type: "loop", hint: "Run steps once per CSV row" },
  { type: "wait", hint: "Pause for a set time" },
  { type: "set-var", hint: "Set a flow variable" },
  { type: "note", hint: "Text to explain the flow" },
];

export interface NodeRunState {
  status: CanvasStatus;
  runs: number;
  /** Run request steps: status code of the last response (null = none). */
  statusCode?: number | null;
}

interface Props {
  flow: Flow;
  items: FlowItems;
  problems: FlowProblem[];
  /** Status per node id from the live run or the run being viewed. */
  runState: Map<string, NodeRunState>;
  /** `group` merges a burst of the same edit (typing in a note) into one undo step. */
  onChange: (flow: Flow, group?: string) => void;
  onSelect: (nodeId: string | null) => void;
  /** Ask to select a node from outside (for example from the problems list). */
  focusNodeId: string | null;
  /** Changes each time the same node is asked for again. */
  focusNonce: number;
  /** Showing a past run: nothing can be moved, wired or changed. */
  readOnly: boolean;
  /** Changes each time the selection should be cleared from outside (settings panel closed). */
  deselectNonce: number;
}

type RFNode = Node<StepData>;

function toRFNode(node: FlowNode, items: FlowItems, problems: FlowProblem[], run: NodeRunState | undefined, prev: RFNode | undefined): RFNode {
  const mine = problems.filter((p) => p.nodeId === node.id);
  const problem = mine.some((p) => p.level === "error") ? "error" : mine.length ? "warning" : undefined;
  const isNote = node.type === "note";
  return {
    ...(prev ?? {}),
    id: node.id,
    type: isNote ? "note" : "step",
    position: prev?.dragging ? prev.position : node.position,
    ...(isNote ? { width: node.width, height: node.height, dragHandle: ".flow-note-grip", zIndex: -1 } : {}),
    data: {
      node,
      label: nodeLabel(node, items.suites, items.findRequest),
      detail: nodeDetail(node, items),
      status: run?.status,
      runs: run?.runs,
      statusCode: run?.statusCode,
      problem,
      problemText: mine.map((p) => p.message).join("\n"),
    },
  };
}

const EDGE_CLASS: Record<FlowOutput, string> = {
  next: "e-next",
  passed: "e-passed",
  failed: "e-failed",
  true: "e-true",
  false: "e-false",
  branches: "e-branches",
  row: "e-row",
  done: "e-next",
};

function Canvas({ flow, items, problems, runState, onChange, onSelect, focusNodeId, focusNonce, readOnly, deselectNonce }: Props) {
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const [rfNodes, setRfNodes] = useState<RFNode[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());

  // Rebuild canvas nodes from the flow, keeping what React Flow measured and selected.
  useEffect(() => {
    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return flow.nodes.map((n) => toRFNode(n, items, problems, runState.get(n.id), byId.get(n.id)));
    });
  }, [flow.nodes, items, problems, runState]);

  useEffect(() => {
    if (!focusNodeId) return;
    setRfNodes((list) => list.map((n) => ({ ...n, selected: n.id === focusNodeId })));
    const n = flowRef.current.nodes.find((x) => x.id === focusNodeId);
    if (n) rf.setCenter(n.position.x + 100, n.position.y + 40, { duration: 250, zoom: rf.getZoom() });
  }, [focusNodeId, focusNonce, rf]);

  // Closing the settings panel clears the selection too, so clicking the same step opens it again.
  useEffect(() => {
    if (deselectNonce === 0) return;
    setRfNodes((list) => list.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setSelectedEdges(new Set());
  }, [deselectNonce]);

  const edges: Edge[] = useMemo(
    () =>
      flow.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: "in",
        className: EDGE_CLASS[e.sourceHandle],
        selected: selectedEdges.has(e.id),
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      })),
    [flow.edges, selectedEdges],
  );

  /** Opens a flow readably: the whole flow when it fits at a readable zoom, otherwise zoom 1 on Start. */
  const showDefaultView = useCallback(
    (animate = false) => {
      const nodes = rf.getNodes().filter((n) => n.measured?.width);
      const wrap = wrapRef.current?.getBoundingClientRect();
      if (nodes.length === 0 || !wrap) return;
      const box = (list: typeof nodes) => rf.getNodesBounds(list);
      const start = nodes.find((n) => (n.data as StepData | undefined)?.node?.type === "start");
      const choice = chooseView(box(nodes), { width: wrap.width, height: wrap.height }, start ? box([start]) : null);
      const duration = animate ? 250 : 0;
      if (choice.kind === "fit") void rf.fitView({ padding: FIT_PADDING, minZoom: READABLE_ZOOM, maxZoom: 1, duration });
      else void rf.setCenter(choice.x, choice.y, { zoom: 1, duration });
    },
    [rf],
  );
  const measured = useNodesInitialized();
  const opened = useRef(false);
  useEffect(() => {
    if (!measured || opened.current) return;
    opened.current = true;
    showDefaultView();
  }, [measured, showDefaultView]);

  /** Arranges the steps left to right. One undo step puts them back. */
  const tidy = useCallback(() => {
    const sizes = new Map(rf.getNodes().filter((n) => n.measured?.width).map((n) => [n.id, { width: n.measured!.width!, height: n.measured!.height! }]));
    onChange(tidyFlow(flowRef.current, sizes));
    requestAnimationFrame(() => showDefaultView(true));
  }, [rf, onChange, showDefaultView]);

  const update = useCallback((patch: (f: Flow) => Flow, group?: string) => onChange(patch(flowRef.current), group), [onChange]);

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      setRfNodes((list) => applyNodeChanges(changes, list));
      const moved = new Map<string, { x: number; y: number }>();
      const removed = new Set<string>();
      for (const c of changes) {
        if (c.type === "position" && c.position && c.dragging === false) moved.set(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
        if (c.type === "remove") removed.add(c.id);
      }
      if (moved.size || removed.size) {
        update((f) => ({
          ...f,
          nodes: f.nodes.filter((n) => !removed.has(n.id)).map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)),
          edges: f.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
        }));
      }
    },
    [update],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
      setSelectedEdges((sel) => {
        const next = applyEdgeChanges(changes, [...flowRef.current.edges].map((e) => ({ id: e.id, source: e.source, target: e.target, selected: sel.has(e.id) })));
        return new Set(next.filter((e) => e.selected).map((e) => e.id));
      });
      if (removed.size) update((f) => ({ ...f, edges: f.edges.filter((e) => !removed.has(e.id)) }));
    },
    [update],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle) return;
      const handle = c.sourceHandle as FlowOutput;
      // Most outputs have one wire, so a new wire from one replaces the old one. Parallel's "branches" takes many.
      const multi = MULTI_WIRE_OUTPUTS.includes(handle);
      update((f) => {
        if (multi && f.edges.some((e) => e.source === c.source && e.sourceHandle === handle && e.target === c.target)) return f;
        return {
          ...f,
          edges: [...f.edges.filter((e) => multi || !(e.source === c.source && e.sourceHandle === handle)), newEdge(c.source!, handle, c.target!)],
        };
      });
    },
    [update],
  );

  const isValidConnection: IsValidConnection = useCallback((c) => {
    if (c.source === c.target) return false;
    const target = flowRef.current.nodes.find((n) => n.id === c.target);
    return !!target && target.type !== "start" && target.type !== "note";
  }, []);

  const addNode = useCallback(
    (type: FlowNodeType, screen?: { x: number; y: number }) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const point = screen ?? (rect ? { x: rect.left + rect.width / 2 - 90, y: rect.top + rect.height / 2 - 30 } : { x: 0, y: 0 });
      const position = rf.screenToFlowPosition(point);
      // Nudge down until the new node doesn't sit on top of another one.
      const taken = flowRef.current.nodes;
      let y = Math.round(position.y);
      const x = Math.round(position.x);
      while (taken.some((n) => Math.abs(n.position.x - x) < 200 && Math.abs(n.position.y - y) < 80)) y += 90;
      const node = newNode(type, { x, y });
      update((f) => ({ ...f, nodes: [...f.nodes, node] }));
      setRfNodes((list) => list.map((n) => ({ ...n, selected: false })));
      onSelect(node.id);
      // Select the new node once it is on the canvas.
      requestAnimationFrame(() => setRfNodes((list) => list.map((n) => ({ ...n, selected: n.id === node.id }))));
    },
    [rf, update, onSelect],
  );

  // Dragging from the palette uses pointer events rather than HTML drag and drop,
  // which the desktop window can intercept for file drops.
  const [ghost, setGhost] = useState<{ type: FlowNodeType; x: number; y: number; moved: boolean } | null>(null);
  const dragging = ghost !== null;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  useEffect(() => {
    if (!dragging) return;
    const start = { x: ghostRef.current!.x, y: ghostRef.current!.y };
    const onMove = (e: PointerEvent) => {
      setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY, moved: g.moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 } : g));
    };
    const onUp = (e: PointerEvent) => {
      const g = ghostRef.current;
      setGhost(null);
      if (!g) return;
      const moved = g.moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!moved) addNode(g.type);
      else if (rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) addNode(g.type, { x: e.clientX - 20, y: e.clientY - 16 });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, addNode]);

  const actions = useMemo(
    () => ({
      readOnly,
      onNoteText: (id: string, text: string) => update((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === id && n.type === "note" ? { ...n, text } : n)) }), `note:${id}`),
      onNoteResize: (id: string, width: number, height: number) =>
        update((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === id && n.type === "note" ? { ...n, width, height } : n)) })),
    }),
    [update, readOnly],
  );

  return (
    <div className="flow-canvas-wrap">
      <div className="flow-palette" role="toolbar" aria-label="Add a step" hidden={readOnly}>
        {PALETTE.map((p) => (
          <button
            key={p.type}
            className={`palette-item type-${p.type}`}
            title={`${p.hint}. Click to add, or drag onto the canvas.`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              setGhost({ type: p.type, x: e.clientX, y: e.clientY, moved: false });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                addNode(p.type);
              }
            }}
          >
            <span className="palette-swatch" aria-hidden />
            {NODE_TYPE_LABELS[p.type]}
          </button>
        ))}
      </div>
      <div className="flow-canvas" ref={wrapRef}>
        <CanvasActions.Provider value={actions}>
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onSelectionChange={({ nodes }) => onSelect(nodes.length === 1 ? nodes[0].id : null)}
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            colorMode="dark"
            minZoom={MIN_ZOOM}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} onFitView={() => showDefaultView(true)} />
            {!readOnly && flow.nodes.length > 1 && (
              <Panel position="top-right">
                <button className="secondary tidy-btn" onClick={tidy} title="Arrange the steps left to right. You can undo it.">
                  Tidy layout
                </button>
              </Panel>
            )}
            <MiniMap pannable zoomable className="flow-minimap" style={{ width: 150, height: 96 }} nodeBorderRadius={4} />
          </ReactFlow>
        </CanvasActions.Provider>
        {flow.nodes.length === 0 && <p className="flow-canvas-empty muted">Add a Start node from the bar above, then the steps to run after it.</p>}
      </div>
      {ghost?.moved && (
        <div className={`palette-ghost type-${ghost.type}`} style={{ left: ghost.x, top: ghost.y }} aria-hidden>
          {NODE_TYPE_LABELS[ghost.type]}
        </div>
      )}
    </div>
  );
}

/** The flow editor canvas with its node palette. */
export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider key={props.flow.id}>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
