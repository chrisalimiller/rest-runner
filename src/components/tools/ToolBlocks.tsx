import { useState } from "react";
import type { RequestLookup } from "../../lib/flows/flows";
import { pendingRows, type SessionState } from "../../lib/tools/session";
import type { CallResult, Tool, ToolBlock, ToolCall } from "../../lib/tools/types";
import {
  callView,
  canRetry,
  fieldRows,
  jsonText,
  numberView,
  rawResponseText,
  requestLine,
  statusBadgeView,
  statusLabel,
  statusTone,
  tableView,
  type CallView,
} from "../../lib/tools/view";
import { BodyView } from "../BodyView";
import { OverflowMenu } from "../shell/OverflowMenu";
import { InputControl } from "./InputControl";

/** The blocks of a tool's page in Use mode. Each fills in by itself when its call finishes. */

export interface BoardActions {
  onInput: (name: string, value: string) => void;
  onRunKey: () => void;
  onRetry: (callId: string) => void;
  onOpenRequest: (requestId: string) => void;
  onCopy: (text: string) => void;
  onPick: (callId: string, index: number | null) => void;
  /** An Action button was pressed: run this write call. */
  onRunAction: (callId: string) => void;
  /** The coloured (production-marked) environment in use, when there is one. Action buttons say so and ask first. */
  guard?: { name: string; cssColor: string } | null;
  /** Whether Retry on this call runs only that call (true) or the whole lookup (false). Default false. */
  retryAlone?: (callId: string) => boolean;
}

interface BoardProps {
  tool: Tool;
  state: SessionState;
  findRequest: RequestLookup;
  actions: BoardActions;
}

/** Blocks grouped by row, rows in order, blocks in array order. */
export function blockRows(blocks: readonly ToolBlock[]): ToolBlock[][] {
  const rows = new Map<number, ToolBlock[]>();
  for (const b of blocks) rows.set(b.row, [...(rows.get(b.row) ?? []), b]);
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

export function ToolBoard({ tool, state, findRequest, actions }: BoardProps) {
  const rows = blockRows(tool.blocks);
  if (rows.length === 0) return <p className="muted tool-empty-board">This tool has no blocks yet. Add some in Build mode.</p>;
  return (
    <div className="tool-board">
      {rows.map((row, i) => (
        <div key={i} className="tool-row" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
          {row.map((b) => (
            <BlockCard key={b.id} block={b} tool={tool} state={state} findRequest={findRequest} actions={actions} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardProps {
  block: ToolBlock;
  tool: Tool;
  state: SessionState;
  findRequest: RequestLookup;
  actions: BoardActions;
}

const NEEDS_CALL: ToolBlock["type"][] = ["fields", "table", "number", "status", "json"];

export function BlockCard({ block, tool, state, findRequest, actions }: CardProps) {
  const [raw, setRaw] = useState(false);
  const call = block.callId ? tool.calls.find((c) => c.id === block.callId) : undefined;
  const result = call ? state.results[call.id] : undefined;
  const view = call
    ? callView({ result, sending: state.sending.includes(call.id), lookingUp: state.running })
    : ({ kind: "idle" } as CallView);
  const def = call ? findRequest(call.requestId) : null;
  const line = requestLine(def);
  const title = block.title || call?.name || "";

  if (block.type === "note") {
    return (
      <section className="tool-block tool-note" data-block="note">
        {title && <h3 className="tool-block-title">{title}</h3>}
        {block.text && <p className="tool-note-text">{block.text}</p>}
      </section>
    );
  }
  if (block.type === "input") {
    const input = tool.inputs.find((i) => i.name === block.inputName);
    return (
      <section className="tool-block tool-input-block" data-block="input">
        {title && <h3 className="tool-block-title">{title}</h3>}
        {input ? (
          <InputControl input={input} value={state.inputs[input.name] ?? ""} onChange={(v) => actions.onInput(input.name, v)} onEnter={actions.onRunKey} />
        ) : (
          <p className="muted small">This block's input was removed.</p>
        )}
      </section>
    );
  }
  if (block.type === "action") {
    return <ActionBody block={block} call={call} title={title} hasRequest={!!def} state={state} actions={actions} />;
  }

  const menu = (
    <OverflowMenu
      label={`${title || "Block"} actions`}
      items={[
        { label: raw ? "Hide raw response" : "Show raw response", onSelect: () => setRaw((r) => !r), disabled: !result },
        { label: "Copy", onSelect: () => actions.onCopy(rawResponseText(result)), disabled: !result },
        { label: "Open request", onSelect: () => call && actions.onOpenRequest(call.requestId), disabled: !def },
      ]}
    />
  );

  const label = statusLabel(view);
  return (
    <section className={`tool-block tool-data state-${view.kind}`} data-block={block.type} data-state={view.kind} aria-busy={view.kind === "running" || view.kind === "waiting"}>
      <header className="tool-block-head">
        <div className="tool-block-heading">
          <h3 className="tool-block-title">{title}</h3>
          {line && (
            <span className="tool-block-request mono" title={`${line.method} ${line.path}`}>
              <span className={`method m-${line.method.toLowerCase()}`}>{line.method}</span> {line.path}
            </span>
          )}
        </div>
        {label && <span className={`tool-block-status tone-${statusTone(view)}`}>{label}</span>}
        {menu}
      </header>
      <div className="tool-block-body">
        <BlockBody block={block} call={call} result={result} view={view} state={state} actions={actions} hasRequest={!!def} />
        {raw && result && (
          <div className="tool-raw">
            <BodyView body={rawResponseText(result)} />
          </div>
        )}
      </div>
    </section>
  );
}

interface ActionProps {
  block: ToolBlock;
  call: ToolCall | undefined;
  title: string;
  hasRequest: boolean;
  state: SessionState;
  actions: BoardActions;
}

/** An Action button: runs a write request with the values on screen, and shows what came back. Never part of Look up. */
function ActionBody({ block, call, title, hasRequest, state, actions }: ActionProps) {
  const label = title || call?.name || "Action";
  const result = call ? state.writes[call.id] : undefined;
  const writing = !!call && state.writing.includes(call.id);
  const usable = !!call && call.write && hasRequest;
  const why = !call ? "No request chosen for this button." : !call.write ? "This is a lookup call, so it runs with Look up." : !hasRequest ? "The request is missing." : state.running ? "Wait for the lookup to finish." : "";
  const guarded = !!actions.guard;
  const view = result ? callView({ result, sending: false, lookingUp: false }) : null;
  return (
    <section className="tool-block tool-action" data-block="action" data-state={writing ? "running" : (view?.kind ?? "idle")} aria-busy={writing}>
      <div className="tool-action-row">
        <button
          type="button"
          className={`secondary tool-action-btn ${guarded ? "guarded" : ""}`}
          disabled={!usable || state.running || writing}
          style={guarded ? ({ "--guard": actions.guard?.cssColor } as React.CSSProperties) : undefined}
          title={why || (guarded ? `Asks first: ${actions.guard?.name} is marked as production` : block.text ? "Asks first" : "Sends this write request")}
          onClick={() => call && actions.onRunAction(call.id)}
        >
          {writing ? "Sending…" : label}
        </button>
        {guarded && <span className="tool-action-env small">on {actions.guard?.name}</span>}
        {why && <span className="muted small">{why}</span>}
      </div>
      {result && view && <ActionResult result={result} view={view} />}
    </section>
  );
}

function ActionResult({ result, view }: { result: CallResult; view: CallView }) {
  if (view.kind === "skipped") {
    const notConfirmed = result.reason === "not-confirmed";
    return (
      <p className={`small ${notConfirmed ? "muted" : "tone-warn"}`} role="status">
        {notConfirmed ? "Not confirmed" : view.message}
        {notConfirmed && " — nothing was sent."}
      </p>
    );
  }
  if (view.kind === "network-error") {
    return (
      <p className="tone-bad small" role="alert">
        {view.message}
      </p>
    );
  }
  if (view.kind === "stopped") return <p className="muted small">Stopped.</p>;
  const body = rawResponseText(result);
  const bad = view.kind === "http-error";
  return (
    <div className="tool-action-result" role="status">
      <p className={`small ${bad ? "tone-bad" : "tone-ok"}`}>
        <strong>{statusLabel(view)}</strong>
        {result.response?.statusText ? ` ${result.response.statusText}` : ""}
      </p>
      {body && <pre className="code-view tool-error-body">{body}</pre>}
    </div>
  );
}

interface BodyProps {
  block: ToolBlock;
  call: ToolCall | undefined;
  result: CallResult | undefined;
  view: CallView;
  state: SessionState;
  actions: BoardActions;
  hasRequest: boolean;
}

function BlockBody({ block, call, result, view, state, actions, hasRequest }: BodyProps) {
  if (!call) return <p className="muted small">{NEEDS_CALL.includes(block.type) ? "No request chosen for this block." : ""}</p>;
  switch (view.kind) {
    case "idle":
      return <p className="muted small">Look up to fill this in.</p>;
    case "waiting":
    case "running":
      return (
        <div className="tool-skeleton" role="status" aria-label={view.kind === "running" ? "Loading" : "Waiting for another call"}>
          <span />
          <span />
          <span />
        </div>
      );
    case "stopped":
      return <p className="muted small">Stopped.</p>;
    case "skipped":
      return <p className={`small ${view.missingRequest ? "tone-bad" : "tone-warn"}`}>{view.message}</p>;
    case "network-error":
      return (
        <div className="tool-problem">
          <p className="tone-bad tool-problem-text">{view.message}</p>
          <div className="tool-problem-actions">{canRetry(view) && <RetryButton call={call} actions={actions} disabled={state.running} />}</div>
        </div>
      );
    case "http-error": {
      const body = rawResponseText(result);
      return (
        <div className="tool-problem">
          <p className="tone-bad tool-problem-text">
            <strong>{view.status}</strong>
            {result?.response?.statusText ? ` ${result.response.statusText}` : ""}
          </p>
          {body && <pre className="code-view tool-error-body">{body}</pre>}
          <div className="tool-problem-actions">
            <RetryButton call={call} actions={actions} disabled={state.running} />
            {hasRequest && (
              <button type="button" className="secondary" onClick={() => actions.onOpenRequest(call.requestId)}>
                Open request
              </button>
            )}
          </div>
        </div>
      );
    }
    case "ok":
      return <OkBody block={block} call={call} result={result} state={state} actions={actions} />;
  }
}

function RetryButton({ call, actions, disabled }: { call: ToolCall; actions: BoardActions; disabled: boolean }) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => actions.onRetry(call.id)}
      disabled={disabled}
      title={actions.retryAlone?.(call.id) ? "Sends this call again" : "Runs the whole lookup again, so anything that depends on this call is refreshed too"}
    >
      Retry
    </button>
  );
}

function OkBody({ block, call, result, state, actions }: { block: ToolBlock; call: ToolCall; result: CallResult | undefined; state: SessionState; actions: BoardActions }) {
  switch (block.type) {
    case "fields": {
      const rows = fieldRows(block, call, result);
      if (rows.length === 0) return <p className="muted small">No fields picked.</p>;
      return (
        <dl className="tool-fields">
          {rows.map((r, i) => (
            <div key={i} className="tool-field">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      );
    }
    case "number": {
      const n = numberView(block, call, result);
      return (
        <p className="tool-number">
          <span className="tool-number-value">{n.value}</span>
          {n.unit && <span className="tool-number-unit">{n.unit}</span>}
        </p>
      );
    }
    case "status": {
      const s = statusBadgeView(block, call, result);
      return (
        <p>
          <span className={`tool-badge badge-${s.colour}`}>{s.text}</span>
        </p>
      );
    }
    case "json": {
      const text = jsonText(block, call, result);
      return (
        <details className="tool-json" open>
          <summary>{block.fields[0]?.path ? block.fields[0].path : "Response"}</summary>
          <pre className="code-view">{text || "(nothing at that path)"}</pre>
        </details>
      );
    }
    case "table":
      return <TableBody block={block} call={call} result={result} state={state} actions={actions} />;
    default:
      return null;
  }
}

function TableBody({ block, call, result, state, actions }: { block: ToolBlock; call: ToolCall; result: CallResult | undefined; state: SessionState; actions: BoardActions }) {
  const t = tableView(block, call, result);
  const picking = pendingRows(state, call.id) !== null;
  if (t.rows.length === 0) return <p className="muted small">No rows.</p>;
  return (
    <div className="tool-table-wrap">
      {picking && <p className="small tool-pick-note">Pick a row. The calls that need it are waiting.</p>}
      <table className="tool-table">
        <thead>
          <tr>
            {t.columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
            {call.pickRow && <th scope="col" className="tool-pick-col" />}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row, ri) => (
            <tr key={ri} className={t.pickedIndex === ri ? "picked" : undefined}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
              {call.pickRow && (
                <td className="tool-pick-col">
                  {picking ? (
                    <button type="button" className="link-btn" onClick={() => actions.onPick(call.id, ri)}>
                      Use this row
                    </button>
                  ) : t.pickedIndex === ri ? (
                    <span className="muted small">Used</span>
                  ) : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {picking && (
        <button type="button" className="link-btn small" onClick={() => actions.onPick(call.id, null)}>
          Use none
        </button>
      )}
    </div>
  );
}
