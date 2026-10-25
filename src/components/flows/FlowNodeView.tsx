import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { createContext, useContext } from "react";
import { NODE_TYPE_LABELS } from "../../lib/flows/flows";
import { NODE_OUTPUTS, type FlowNode, type FlowOutput, type FlowStepStatus, type NoteNode } from "../../lib/flows/types";

export type CanvasStatus = FlowStepStatus | "running";

export interface StepData extends Record<string, unknown> {
  node: FlowNode;
  label: string;
  detail: string;
  /** From the live run or the run being viewed. */
  status?: CanvasStatus;
  /** How many times this node ran in that run, when more than once. */
  runs?: number;
  problem?: "error" | "warning";
  problemText?: string;
}

export type StepRFNode = Node<StepData, "step">;
export type NoteRFNode = Node<StepData, "note">;

/** Lets nodes on the canvas change the flow without rebuilding every node's data. */
export const CanvasActions = createContext<{
  onNoteText: (id: string, text: string) => void;
  onNoteResize: (id: string, width: number, height: number) => void;
  readOnly: boolean;
}>({ onNoteText: () => {}, onNoteResize: () => {}, readOnly: false });

const OUTPUT_LABELS: Record<FlowOutput, string> = {
  next: "",
  passed: "passed",
  failed: "failed",
  true: "true",
  false: "false",
  branches: "branches",
  row: "each row",
  done: "done",
};

const STATUS_LABELS: Record<CanvasStatus, string> = { running: "Running", passed: "Passed", failed: "Failed", done: "Done", cancelled: "Stopped" };

function StatusMark({ status }: { status: CanvasStatus }) {
  if (status === "running") return <span className="flow-node-status running" aria-label="Running" />;
  const mark = status === "passed" || status === "done" ? "✓" : status === "failed" ? "✕" : "■";
  return (
    <span className={`flow-node-status ${status}`} aria-label={STATUS_LABELS[status]} title={STATUS_LABELS[status]}>
      {mark}
    </span>
  );
}

/** Every runnable node: a card with an input on the left and its outputs on the right. */
export function StepNodeView({ data, selected }: NodeProps<StepRFNode>) {
  const { node, label, detail, status, runs, problem, problemText } = data;
  const outputs = NODE_OUTPUTS[node.type];
  const retry = "retry" in node && node.retry.times > 0 ? node.retry.times : 0;
  return (
    <div className={`flow-node type-${node.type} ${selected ? "selected" : ""} ${status ? `st-${status}` : ""} ${problem ? `has-${problem}` : ""}`}>
      {node.type !== "start" && <Handle type="target" position={Position.Left} id="in" className="flow-handle in" />}
      <div className="flow-node-head">
        <span className="flow-node-kind">{NODE_TYPE_LABELS[node.type]}</span>
        {retry > 0 && (
          <span className="flow-node-badge" title={`Retries up to ${retry} time${retry === 1 ? "" : "s"}`}>
            ↻ {retry}
          </span>
        )}
        {runs && runs > 1 && (
          <span className="flow-node-badge" title={`Ran ${runs} times`}>
            ×{runs}
          </span>
        )}
        {problem && (
          <span className={`flow-node-problem ${problem}`} title={problemText}>
            !
          </span>
        )}
        {status && <StatusMark status={status} />}
      </div>
      <div className="flow-node-label" title={label}>
        {label}
      </div>
      {detail && (
        <div className="flow-node-detail mono" title={detail}>
          {detail}
        </div>
      )}
      <div className="flow-node-outputs">
        {outputs.map((o) => (
          <div key={o} className={`flow-node-output out-${o}`}>
            {OUTPUT_LABELS[o] && <span>{OUTPUT_LABELS[o]}</span>}
            <Handle type="source" position={Position.Right} id={o} className={`flow-handle out-${o}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A sticky note: free text, resizable, never run. */
export function NoteNodeView({ data, selected }: NodeProps<NoteRFNode>) {
  const node = data.node as NoteNode;
  const actions = useContext(CanvasActions);
  return (
    <div className={`flow-note ${selected ? "selected" : ""}`}>
      <NodeResizer
        isVisible={selected && !actions.readOnly}
        minWidth={120}
        minHeight={60}
        lineClassName="flow-note-resize-line"
        handleClassName="flow-note-resize-handle"
        onResizeEnd={(_e, p) => actions.onNoteResize(node.id, Math.round(p.width), Math.round(p.height))}
      />
      <div className="flow-note-grip" title="Drag to move" />
      <textarea
        className="flow-note-text nodrag nowheel"
        value={node.text}
        placeholder="Write a note…"
        readOnly={actions.readOnly}
        onChange={(e) => actions.onNoteText(node.id, e.target.value)}
        aria-label="Sticky note"
        spellCheck
      />
    </div>
  );
}
