import type { RequestLookup } from "../../lib/flows/flows";
import { whenLabel } from "../../lib/earlierSends";
import type { SessionState } from "../../lib/tools/session";
import type { Tool, ToolProblem } from "../../lib/tools/types";
import { inputsSummary, progressCounts } from "../../lib/tools/view";
import { guardFor, type Environment } from "../../lib/environments";
import { ToolBoard, type BoardActions } from "./ToolBlocks";
import { InputControl } from "./InputControl";

interface Props {
  tool: Tool;
  state: SessionState;
  findRequest: RequestLookup;
  environment: Environment | null;
  problems: ToolProblem[];
  onLookup: () => void;
  onStop: () => void;
  onCopyAll: () => void;
  onSaveHtml: () => void;
  actions: Omit<BoardActions, "onRunKey">;
}

/** Use mode: the inputs, a Look up button, and the blocks. Nothing is sent until Look up (or Enter) is pressed. */
export function ToolUse({ tool, state, findRequest, environment, problems, onLookup, onStop, onCopyAll, onSaveHtml, actions }: Props) {
  const shownInInputBlocks = new Set(tool.blocks.filter((b) => b.type === "input").map((b) => b.inputName));
  const barInputs = tool.inputs.filter((i) => !shownInInputBlocks.has(i.name));
  const errors = problems.filter((p) => p.level === "error");
  const guard = guardFor(environment);
  const counts = progressCounts(tool, state.results, state.sending);
  const hasAny = Object.keys(state.results).length > 0 || state.running;
  const boardActions: BoardActions = { ...actions, onRunKey: onLookup };

  return (
    <main className="tool-main">
      <div className="tool-head">
        <div className="tool-title">
          <h2>{tool.name || "(unnamed)"}</h2>
          {tool.description && <p className="muted small">{tool.description}</p>}
        </div>
      </div>
      <form
        className="tool-inputs"
        onSubmit={(e) => {
          e.preventDefault();
          onLookup();
        }}
        aria-label="Look up"
      >
        {barInputs.map((i) => (
          <InputControl key={i.name} input={i} value={state.inputs[i.name] ?? ""} onChange={(v) => actions.onInput(i.name, v)} onEnter={onLookup} />
        ))}
        <button
          type="submit"
          className={`send tool-lookup ${guard ? "guarded" : ""}`}
          style={guard ? ({ "--guard": guard.cssColor } as React.CSSProperties) : undefined}
          disabled={state.running || errors.length > 0}
          title={errors.length > 0 ? errors[0].message : "Send this tool's requests and fill in the blocks"}
        >
          {guard ? `Look up on ${guard.name}` : "Look up"}
        </button>
      </form>
      {state.error && (
        <p className="tool-error tone-bad" role="alert">
          {state.error}
        </p>
      )}
      {errors.length > 0 && !state.error && (
        <p className="tool-error tone-bad" role="alert">
          {errors[0].message}
        </p>
      )}
      <div className="tool-status-line" role="status">
        {state.viewing && (
          <span className="tool-viewing">
            Saved lookup from {new Date(state.viewing.startedAt).toLocaleString()}
            {state.viewing.environmentName ? ` · ${state.viewing.environmentName}` : ""}
            {inputsSummary(state.viewing.inputs) ? ` · ${inputsSummary(state.viewing.inputs)}` : ""}. Nothing was sent.
          </span>
        )}
        {!state.viewing && state.startedAt && (
          <span className="muted">
            {state.running ? "Looking up…" : `Looked up ${whenLabel(state.startedAt)}`}
            {state.stopped ? " · stopped" : ""}
          </span>
        )}
        {!hasAny && !state.viewing && <span className="muted">Not looked up yet.</span>}
        {hasAny && (
          <span className="tool-counts">
            {counts.done} of {counts.total} calls done{counts.running > 0 ? `, ${counts.running} running` : ""}
          </span>
        )}
        <span className="flex-gap" />
        {state.running && (
          <button type="button" className="send cancel" onClick={onStop}>
            Stop
          </button>
        )}
        <button type="button" className="secondary" onClick={onCopyAll} disabled={!hasAny || state.running}>
          Copy all
        </button>
        <button type="button" className="secondary" onClick={onSaveHtml} disabled={!hasAny || state.running} title="Save these answers as a web page to send to someone. Secret values are masked.">
          Save as HTML
        </button>
      </div>
      <div className="tool-scroll">
        <ToolBoard tool={tool} state={state} findRequest={findRequest} actions={boardActions} />
      </div>
    </main>
  );
}
