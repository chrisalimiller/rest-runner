import { useRef, useState } from "react";
import { requestPlaceholders } from "../../lib/request";
import { formatMs } from "../../lib/earlierSends";
import type { RequestLookup } from "../../lib/flows/flows";
import { callNeeds, findList, listsToAsk } from "../../lib/tools/lists";
import { pendingRows, type PendingPick, type SessionState } from "../../lib/tools/session";
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
  /** The user chose a row (or, with `listId`, an item of one of the call's lists) while a lookup waits for it. Null for none. */
  onPick: (callId: string, index: number | null, listId?: string) => void;
  /** An Action button was pressed: run this write call. */
  onRunAction: (callId: string) => void;
  /** The coloured (production-marked) environment in use, when there is one. Action buttons say so and ask first. */
  guard?: { name: string; cssColor: string } | null;
  /** Change the row picked in a pick-a-row call after the lookup finished; only the calls that read from it run again. Without this the picked row is read-only. */
  onChangeRow?: (callId: string, index: number | null, listId?: string) => void;
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
        <BlockBody block={block} tool={tool} call={call} result={result} view={view} state={state} actions={actions} hasRequest={!!def} findRequest={findRequest} />
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

/** The pick (of a pick-a-row call, or of one list) this call is waiting on, directly or through other calls, when a pick is open. */
export function pickWaitingFor(tool: Tool, call: ToolCall, state: SessionState, findRequest?: RequestLookup): PendingPick | null {
  if (state.pending.length === 0) return null;
  const byId = new Map(tool.calls.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const walk = (c: ToolCall): PendingPick | null => {
    const def = findRequest?.(c.requestId);
    for (const n of callNeeds(c, def ? requestPlaceholders(def) : null, byId)) {
      const hit = state.pending.find((p) => p.callId === n.callId && (p.listId === undefined || n.lists.includes(p.listId)));
      if (hit) return hit;
      if (seen.has(n.callId)) continue;
      seen.add(n.callId);
      const next = byId.get(n.callId);
      const found = next ? walk(next) : null;
      if (found) return found;
    }
    return null;
  };
  return walk(call);
}

/** The pick-a-row call this call is waiting on (directly or through other calls), when a pick is open. */
export function pickBlocking(tool: Tool, call: ToolCall, state: SessionState, findRequest?: RequestLookup): string | null {
  return pickWaitingFor(tool, call, state, findRequest)?.callId ?? null;
}

/** An open list pick that one of this block's fields reads with the "ask" rule. */
function fieldWaitsForPick(block: ToolBlock, call: ToolCall, state: SessionState): PendingPick | null {
  if (state.pending.length === 0) return null;
  return (
    state.pending.find(
      (p) =>
        p.callId === call.id &&
        p.listId !== undefined &&
        block.fields.some((f) => {
          const ref = f.list;
          if (!ref || ref.listId !== p.listId) return false;
          const rule = ref.item ?? findList(call, p.listId!)?.choose;
          return rule?.kind === "ask";
        }),
    ) ?? null
  );
}

function PickWait({ name, callId, listId }: { name: string; callId: string; listId?: string }) {
  return (
    <p className="small tool-waiting-pick" role="status">
      Waiting for a row in {name}.{" "}
      <button type="button" className="link-btn" onClick={() => focusPickTable(callId, listId)}>
        Go to the table
      </button>
    </p>
  );
}

/** What a waiting pick is called: the list's name, or for a pick-a-row call its table's title (else the call's name). */
function pickName(tool: Tool, pick: PendingPick): string {
  const call = tool.calls.find((c) => c.id === pick.callId);
  if (pick.listId !== undefined) return (call && findList(call, pick.listId)?.name) || "the list";
  const table = tool.blocks.find((b) => b.type === "table" && b.callId === pick.callId);
  return table?.title || call?.name || "the list";
}

function focusPickTable(callId: string, listId?: string) {
  const list = listId === undefined ? "" : `[data-pick-list="${CSS.escape(listId)}"]`;
  const el = document.querySelector<HTMLElement>(`[data-pick-call="${CSS.escape(callId)}"]${list}`);
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
  findRequest: RequestLookup;
}

function BlockBody({ block, tool, call, result, view, state, actions, hasRequest, findRequest }: BodyProps) {
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
      const blocking = view.kind === "waiting" ? pickWaitingFor(tool, call, state, findRequest) : null;
      if (blocking) return <PickWait name={pickName(tool, blocking)} callId={blocking.callId} listId={blocking.listId} />;
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
      return <OkBody block={block} tool={tool} call={call} result={result} state={state} actions={actions} />;
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

function OkBody({ block, tool, call, result, state, actions }: { block: ToolBlock; tool: Tool; call: ToolCall; result: CallResult | undefined; state: SessionState; actions: BoardActions }) {
  // A value that reads an item you have not picked yet says so, instead of showing a dash.
  const waiting = block.type !== "table" ? fieldWaitsForPick(block, call, state) : null;
  if (waiting) return <PickWait name={pickName(tool, waiting)} callId={waiting.callId} listId={waiting.listId} />;
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
      return <TableBody block={block} tool={tool} call={call} result={result} state={state} actions={actions} />;
    default:
      return null;
  }
}

/** Tables on a list with more rows than this get a filter box. */
export const FILTER_ROWS_ABOVE = 50;

function TableBody({ block, tool, call, result, state, actions }: { block: ToolBlock; tool: Tool; call: ToolCall; result: CallResult | undefined; state: SessionState; actions: BoardActions }) {
  const t = tableView(block, call, result);
  // A table on a list the lookup asks about is its radio group; a pick-a-row call's table is one as before.
  const listId = block.listId !== undefined && listsToAsk(tool, call).includes(block.listId) ? block.listId : undefined;
  const isPick = !!call.pickRow || listId !== undefined;
  const picking = pendingRows(state, call.id, listId) !== null;
  const canChange = !picking && !state.running && !!actions.onChangeRow && (listId !== undefined || t.pickedIndex !== null);
  const selectable = isPick && (picking || canChange);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const filterable = block.listId !== undefined && t.rows.length > FILTER_ROWS_ABOVE;
  const q = filterable ? query.trim().toLowerCase() : "";
  // Row numbers stay those of the whole list, so picking a row of a filtered table picks the right one.
  const visible = t.rows.map((_, i) => i).filter((i) => q === "" || t.rows[i].some((cell) => cell.toLowerCase().includes(q)));
  if (t.rows.length === 0) return <p className="muted small">{t.note ?? "No rows."}</p>;
  const choose = (ri: number) => {
    if (picking) actions.onPick(call.id, ri, listId);
    else if (canChange && ri !== t.pickedIndex) actions.onChangeRow?.(call.id, ri, listId);
  };
  const wanted = focusAt ?? t.pickedIndex ?? 0;
  const tabStop = visible.includes(wanted) ? wanted : (visible[0] ?? 0);
  const onKeyDown = (e: React.KeyboardEvent, ri: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(ri);
      return;
    }
    const to = nextRowIndex(e.key, visible.indexOf(ri), visible.length);
    if (to === null) return;
    e.preventDefault();
    setFocusAt(visible[to]);
    rowRefs.current[visible[to]]?.focus();
  };
  const label = block.title || call.name;
  return (
    <div className="tool-table-wrap" data-pick-call={isPick ? call.id : undefined} data-pick-list={listId}>
      {picking && <p className="small tool-pick-note">Pick a row. The calls that need it are waiting.</p>}
      {filterable && (
        <div className="tool-table-filter">
          <input className="search" type="search" placeholder="Filter rows" aria-label={`Filter ${label} rows`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {q !== "" && (
            <span className="muted small" role="status">
              {visible.length} of {t.rows.length}
            </span>
          )}
        </div>
      )}
      <table className={`tool-table${selectable ? " selectable" : ""}`} role={isPick ? "radiogroup" : undefined} aria-label={isPick ? `${label}: choose a row` : undefined}>
        <thead>
          <tr role={isPick ? "presentation" : undefined}>
            {t.columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((ri) => (
            <tr
              key={ri}
              ref={(el) => {
                rowRefs.current[ri] = el;
              }}
              className={t.pickedIndex === ri ? "picked" : undefined}
              role={isPick ? "radio" : undefined}
              aria-checked={isPick ? t.pickedIndex === ri : undefined}
              aria-disabled={isPick && !selectable ? true : undefined}
              tabIndex={selectable ? (ri === tabStop ? 0 : -1) : undefined}
              onClick={selectable ? () => choose(ri) : undefined}
              onFocus={selectable ? () => setFocusAt(ri) : undefined}
              onKeyDown={selectable ? (e) => onKeyDown(e, ri) : undefined}
            >
              {t.rows[ri].map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 && <p className="muted small">No rows match "{query.trim()}".</p>}
      {picking && (
        <button type="button" className="secondary tool-pick-none" onClick={() => actions.onPick(call.id, null, listId)}>
          Use none
        </button>
      )}
    </div>
  );
}
