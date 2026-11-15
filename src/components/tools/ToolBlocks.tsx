import { useRef, useState } from "react";
import { formatMs } from "../../lib/earlierSends";
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
import { RainbowText } from "../RainbowText";
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
  /** Change the row picked in a pick-a-row call after the lookup finished; only the calls that read from it run again. Without this the picked row is read-only. */
  onChangeRow?: (callId: string, index: number | null) => void;
  /** A block's request is gone: switch to Build with this block selected so another request can be chosen. */
  onChooseRequest?: (blockId: string) => void;
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

  const head = headerStatus(view);
  const sent = line ? `${line.method} ${line.path}` : undefined;
  return (
    <section className={`tool-block tool-data state-${view.kind}`} data-block={block.type} data-state={view.kind} aria-busy={view.kind === "running" || view.kind === "waiting"}>
      <header className="tool-block-head">
        <h3 className="tool-block-title">{title}</h3>
        {head && (
          <span className={`tool-block-status tone-${head.tone}${head.loud ? " loud" : ""}`} title={sent}>
            {head.text}
          </span>
        )}
        {menu}
      </header>
      <div className="tool-block-body">
        <BlockBody block={block} tool={tool} call={call} result={result} view={view} state={state} actions={actions} hasRequest={!!def} />
        {raw && result && (
          <div className="tool-raw">
            <BodyView body={rawResponseText(result)} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * What the card header says about the call. The request line (method and URL) is not shown on the card: it is in the
 * tooltip of this status, in ⋯ → Show raw response and in Open request. A 2xx is the normal case, so it shows only
 * the time, faint; anything else says its status plainly.
 */
export function headerStatus(view: CallView): { text: string; tone: string; loud: boolean } | null {
  if ((view.kind === "ok" || view.kind === "http-error") && view.status >= 200 && view.status < 300) {
    return view.ms === undefined ? null : { text: formatMs(view.ms), tone: "faint", loud: false };
  }
  const text = statusLabel(view);
  return text ? { text, tone: statusTone(view), loud: view.kind === "http-error" || view.kind === "network-error" } : null;
}

/** Where the arrow keys, Home and End move in a list of `count` rows, or null when the key does nothing. */
export function nextRowIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return Math.min(count - 1, current + 1);
    case "ArrowUp":
    case "ArrowLeft":
      return Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The pick-a-row call this call is waiting on (directly or through other calls), when a pick is open. */
export function pickBlocking(tool: Tool, call: ToolCall, state: SessionState): string | null {
  if (state.pending.length === 0) return null;
  const pending = new Set(state.pending.map((p) => p.callId));
  const seen = new Set<string>();
  const walk = (c: ToolCall): string | null => {
    for (const m of Object.values(c.mappings)) {
      const id = m?.call?.callId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (pending.has(id)) return id;
      const next = tool.calls.find((x) => x.id === id);
      const found = next ? walk(next) : null;
      if (found) return found;
    }
    return null;
  };
  return walk(call);
}

function focusPickTable(callId: string) {
  const el = document.querySelector<HTMLElement>(`[data-pick-call="${CSS.escape(callId)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
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
  tool: Tool;
  call: ToolCall | undefined;
  result: CallResult | undefined;
  view: CallView;
  state: SessionState;
  actions: BoardActions;
  hasRequest: boolean;
}

function BlockBody({ block, tool, call, result, view, state, actions, hasRequest }: BodyProps) {
  if (!call) return <p className="muted small">{NEEDS_CALL.includes(block.type) ? "No request chosen for this block." : ""}</p>;
  switch (view.kind) {
    case "idle":
      return (
        <p className="tool-idle" aria-label="Not looked up yet">
          —
        </p>
      );
    case "waiting":
    case "running": {
      const blocking = view.kind === "waiting" ? pickBlocking(tool, call, state) : null;
      if (blocking) {
        const table = tool.blocks.find((b) => b.type === "table" && b.callId === blocking);
        const name = table?.title || tool.calls.find((c) => c.id === blocking)?.name || "the list";
        return (
          <p className="small tool-waiting-pick" role="status">
            Waiting for a row in {name}.{" "}
            <button type="button" className="link-btn" onClick={() => focusPickTable(blocking)}>
              Go to the table
            </button>
          </p>
        );
      }
      return (
        <div className="tool-skeleton" role="status" aria-label={view.kind === "running" ? "Loading" : "Waiting for another call"}>
          <span />
          <span />
          <span />
        </div>
      );
    }
    case "stopped":
      return <p className="muted small">Stopped.</p>;
    case "skipped":
      return (
        <div className="tool-problem">
          <p className={`small tool-problem-text ${view.missingRequest ? "tone-bad" : "tone-warn"}`}>{view.message}</p>
          {view.missingRequest && actions.onChooseRequest && (
            <div className="tool-problem-actions">
              <button type="button" className="secondary" onClick={() => actions.onChooseRequest?.(block.id)}>
                Choose another request
              </button>
            </div>
          )}
        </div>
      );
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
  const alone = actions.retryAlone?.(call.id) ?? false;
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => actions.onRetry(call.id)}
      disabled={disabled}
      title={alone ? "Sends this call again" : "Runs the whole lookup again, so anything that depends on this call is refreshed too"}
    >
      {alone ? "Retry" : "Run lookup again"}
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
          <pre className="code-view">{text ? <RainbowText text={text} /> : "(nothing at that path)"}</pre>
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
  const canChange = !picking && !state.running && !!actions.onChangeRow && t.pickedIndex !== null;
  const selectable = !!call.pickRow && (picking || canChange);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  if (t.rows.length === 0) return <p className="muted small">No rows.</p>;
  const choose = (ri: number) => {
    if (picking) actions.onPick(call.id, ri);
    else if (canChange && ri !== t.pickedIndex) actions.onChangeRow?.(call.id, ri);
  };
  const tabStop = focusAt ?? t.pickedIndex ?? 0;
  const onKeyDown = (e: React.KeyboardEvent, ri: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(ri);
      return;
    }
    const to = nextRowIndex(e.key, ri, t.rows.length);
    if (to === null) return;
    e.preventDefault();
    setFocusAt(to);
    rowRefs.current[to]?.focus();
  };
  return (
    <div className="tool-table-wrap" data-pick-call={call.pickRow ? call.id : undefined}>
      {picking && <p className="small tool-pick-note">Pick a row. The calls that need it are waiting.</p>}
      <table className={`tool-table${selectable ? " selectable" : ""}`} role={call.pickRow ? "radiogroup" : undefined} aria-label={call.pickRow ? `${block.title || call.name}: choose a row` : undefined}>
        <thead>
          <tr role={call.pickRow ? "presentation" : undefined}>
            {t.columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row, ri) => (
            <tr
              key={ri}
              ref={(el) => {
                rowRefs.current[ri] = el;
              }}
              className={t.pickedIndex === ri ? "picked" : undefined}
              role={call.pickRow ? "radio" : undefined}
              aria-checked={call.pickRow ? t.pickedIndex === ri : undefined}
              aria-disabled={call.pickRow && !selectable ? true : undefined}
              tabIndex={selectable ? (ri === tabStop ? 0 : -1) : undefined}
              onClick={selectable ? () => choose(ri) : undefined}
              onFocus={selectable ? () => setFocusAt(ri) : undefined}
              onKeyDown={selectable ? (e) => onKeyDown(e, ri) : undefined}
            >
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {picking && (
        <button type="button" className="secondary tool-pick-none" onClick={() => actions.onPick(call.id, null)}>
          Use none
        </button>
      )}
    </div>
  );
}
