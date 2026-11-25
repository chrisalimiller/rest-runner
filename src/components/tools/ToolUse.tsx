import { useEffect, useRef } from "react";
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
  /** False while the Tools section is hidden; focus-on-open waits for it. */
  active?: boolean;
  onLookup: () => void;
  onStop: () => void;
  onCopyAll: () => void;
  onSaveHtml: () => void;
  actions: Omit<BoardActions, "onRunKey">;
}

/**
 * Whether opening a tool may move focus: not while the user is typing in a field elsewhere (a search box, a dialog).
 * A button, the page body or nothing at all is fair game, so clicking a tool in the sidebar lands in its first input.
 */
export function mayTakeFocus(active: { tagName: string; isContentEditable?: boolean } | null, insideTool = false): boolean {
  if (!active || insideTool || active.tagName === "BODY") return true;
  if (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT") return false;
  return !active.isContentEditable;
}

/** Use mode: the inputs and a Look up button in one header row, then the blocks. Nothing is sent until Look up (or Enter) is pressed. */
export function ToolUse({ tool, state, findRequest, environment, problems, active = true, onLookup, onStop, onCopyAll, onSaveHtml, actions }: Props) {
  // Inputs live in the header row beside Look up; Input blocks would only repeat them, so the board leaves them out.
  const boardTool = tool.blocks.some((b) => b.type === "input") ? { ...tool, blocks: tool.blocks.filter((b) => b.type !== "input") } : tool;
  const onlyInputs = tool.blocks.length > 0 && boardTool.blocks.length === 0;
  const errors = problems.filter((p) => p.level === "error");
  const guard = guardFor(environment);
  const counts = progressCounts(tool, state.results, state.sending);
  const viewingText = state.viewing
    ? `Saved lookup · ${whenLabel(state.viewing.startedAt)}${state.viewing.environmentName ? ` · ${state.viewing.environmentName}` : ""}${inputsSummary(state.viewing.inputs) ? ` · ${inputsSummary(state.viewing.inputs)}` : ""} · Nothing was sent`
    : "";
  const hasAny = Object.keys(state.results).length > 0 || state.running;
  const boardActions: BoardActions = { ...actions, onRunKey: onLookup };
  const formRef = useRef<HTMLFormElement>(null);

  // Once per open (a new tool, or coming back to the Tools section): the first input, else Look up.
  useEffect(() => {
    if (!active) return;
    const form = formRef.current;
    if (!form || !mayTakeFocus(document.activeElement, form.contains(document.activeElement))) return;
    const target = form.querySelector<HTMLElement>("input, select") ?? form.querySelector<HTMLElement>("button[type=submit]");
    target?.focus();
  }, [tool.id, active]);

  return (
    <main className="tool-main">
      <div className="tool-head tool-use-head">
        <div className="tool-head-top">
          <div className="tool-title">
            <h2>{tool.name || "(unnamed)"}</h2>
            {tool.description && <p className="muted small">{tool.description}</p>}
          </div>
          <div className="tool-head-actions">
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
        </div>
        <form
          ref={formRef}
          className="tool-use-bar"
          onSubmit={(e) => {
            e.preventDefault();
            onLookup();
          }}
          aria-label="Tool inputs"
        >
          {tool.inputs.map((i) => (
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
          <div className={`tool-status ${state.viewing ? "saved" : ""}`} role="status" >
            {state.viewing && (
              <span className="tool-viewing" title={viewingText}>
                <strong>Saved lookup</strong>
                {viewingText.slice("Saved lookup".length)}
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
          </div>
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
      </div>
      <div className="tool-scroll">
        {!onlyInputs && !hasAny && !state.viewing && <p className="muted tool-idle-line">Look up to fill these in.</p>}
        {onlyInputs ? (
          <p className="muted tool-empty-board">This tool only has inputs. Add blocks for the answers in Build mode.</p>
        ) : (
          <ToolBoard tool={boardTool} state={state} findRequest={findRequest} actions={boardActions} />
        )}
      </div>
    </main>
  );
}
