import { useMemo, useState } from "react";
import type { RequestLookup } from "../../lib/flows/flows";
import { addCall, callGives, callGroups, callNeeds, guessLabelPath, listPathOptions, removeCall, renameCall, setCallWrite, setPickRow } from "../../lib/tools/builder";
import { callJson } from "../../lib/tools/engine";
import { listPickableRequests, type PickableRequest } from "../../lib/testing/requestSources";
import type { CallResult, Tool, ToolCall } from "../../lib/tools/types";
import { requestLine } from "../../lib/tools/view";
import { TrashIcon } from "../shell/Icons";

/** What a dragged saved request carries, so the Calls column (or any later source) can accept it. */
export const REQUEST_DRAG_TYPE = "application/x-rest-runner-request";

interface Props {
  tool: Tool;
  findRequest: RequestLookup;
  results: Record<string, CallResult>;
  onChange: (tool: Tool) => void;
  onEditInputs: () => void;
  onFillIn: (callId: string) => void;
  onOpenRequest: (requestId: string) => void;
}

/** The Calls column of Build mode: calls in run order, grouped Input, Step 1, Step 2... */
export function CallsColumn({ tool, findRequest, results, onChange, onEditInputs, onFillIn, onOpenRequest }: Props) {
  const groups = callGroups(tool, findRequest);
  const [picking, setPicking] = useState(false);
  const [over, setOver] = useState(false);

  const add = (r: PickableRequest) => {
    const { tool: next } = addCall(tool, { id: r.id, name: r.request.name || r.path[r.path.length - 1], method: r.request.method });
    onChange(next);
  };
  const accepts = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(REQUEST_DRAG_TYPE);

  return (
    <aside
      className={`build-calls ${over ? "drop-over" : ""}`}
      aria-label="Calls"
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        const id = e.dataTransfer.getData(REQUEST_DRAG_TYPE);
        const r = listPickableRequests().find((x) => x.id === id);
        if (r) add(r);
      }}
    >
      <div className="build-col-head">
        <h3>Calls</h3>
        <button type="button" className="secondary" onClick={() => setPicking(!picking)} aria-expanded={picking}>
          {picking ? "Close" : "Add request"}
        </button>
      </div>
      {picking && <AddRequestPanel onAdd={(r) => add(r)} onClose={() => setPicking(false)} />}
      <div className="build-calls-scroll">
        {!groups.ok && (
          <p className="build-cycle tone-bad" role="alert">
            {groups.message} Change where a value comes from, or this tool cannot be saved.
          </p>
        )}
        <section className="call-group" aria-label="Input">
          <h4>Input</h4>
          {tool.inputs.length === 0 ? (
            <p className="muted small">No inputs yet.</p>
          ) : (
            <ul className="call-inputs">
              {tool.inputs.map((i) => (
                <li key={i.name}>
                  <span className="call-input-name">{i.label || i.name}</span>
                  <span className="muted small mono">{`{{${i.name}}}`}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link-btn small" onClick={onEditInputs}>
            Edit inputs
          </button>
        </section>
        {tool.calls.length === 0 && (
          <p className="muted small build-calls-empty">
            Add a saved request to start. Drag one in, or use Add request. A call shows what it needs on its way in and what it gives back.
          </p>
        )}
        {groups.groups.map((g) => (
          <section key={g.label} className="call-group" aria-label={g.label}>
            <h4>{g.label}</h4>
            <ul>
              {g.calls.map((c) => (
                <CallCard key={c.id} tool={tool} call={c} findRequest={findRequest} result={results[c.id]} onChange={onChange} onFillIn={() => onFillIn(c.id)} onOpenRequest={onOpenRequest} inLoop={!groups.ok && groups.cycle.includes(c.id)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

interface CardProps {
  tool: Tool;
  call: ToolCall;
  findRequest: RequestLookup;
  result: CallResult | undefined;
  onChange: (tool: Tool) => void;
  onFillIn: () => void;
  onOpenRequest: (id: string) => void;
  inLoop: boolean;
}

function CallCard({ tool, call, findRequest, result, onChange, onFillIn, onOpenRequest, inLoop }: CardProps) {
  const def = findRequest(call.requestId);
  const line = requestLine(def);
  const needs = callNeeds(tool, call, findRequest);
  const gives = callGives(tool, call);
  const usedBy = tool.blocks.filter((b) => b.callId === call.id).length;
  const rowList = result?.state === "done" ? listPathOptions(callJson(result)) : [];

  const togglePick = (on: boolean) => {
    if (!on) return onChange(setPickRow(tool, call.id, null));
    const json = result?.state === "done" ? callJson(result) : undefined;
    const list = rowList[0] ?? "$";
    const rows = Array.isArray(json) ? json : (json as Record<string, unknown> | undefined)?.[list.replace(/^\$\./, "")];
    onChange(setPickRow(tool, call.id, { listPath: list, labelPath: guessLabelPath(Array.isArray(rows) ? rows[0] : undefined) }));
  };

  return (
    <li className={`call-card ${inLoop ? "in-loop" : ""} ${!def ? "missing" : ""}`}>
      <div className="call-head">
        <input className="call-name" type="text" value={call.name} aria-label="Call name" onChange={(e) => onChange(renameCall(tool, call.id, e.target.value))} spellCheck={false} />
        <button
          type="button"
          className="icon-btn"
          aria-label={`Remove ${call.name || "call"}`}
          title={usedBy > 0 ? `Remove this call (${usedBy} block${usedBy === 1 ? "" : "s"} will be left without a request)` : "Remove this call"}
          onClick={() => onChange(removeCall(tool, call.id))}
        >
          <TrashIcon />
        </button>
      </div>
      {line ? (
        <button type="button" className="call-request mono" onClick={() => onOpenRequest(call.requestId)} title="Open this request in Requests">
          <span className={`method m-${line.method.toLowerCase()}`}>{line.method}</span> {line.path}
        </button>
      ) : (
        <p className="call-request tone-bad small">Request missing. It was deleted from Requests.</p>
      )}
      {needs && needs.length > 0 && (
        <dl className="call-io">
          <dt>Needs</dt>
          <dd>
            {needs.map((n) => (
              <span key={n.placeholder} className={`call-chip from-${n.from[0].kind}`} title={n.from.map((f) => f.text).join(", then ")}>
                {n.placeholder} <span className="muted">← {n.from.map((f) => f.text).join(" / ")}</span>
              </span>
            ))}
          </dd>
        </dl>
      )}
      {gives.length > 0 && (
        <dl className="call-io">
          <dt>Gives</dt>
          <dd>
            {gives.map((g) => (
              <span key={g} className="call-chip give">
                {g}
              </span>
            ))}
          </dd>
        </dl>
      )}
      <div className="call-options">
        <label className="check small" title="Write calls change data, so they run only from an Action button, never in Look up">
          <input type="checkbox" checked={call.write} onChange={(e) => onChange(setCallWrite(tool, call.id, e.target.checked))} />
          <span>Write call</span>
        </label>
        <label className="check small" title="When the response is a list, stop and ask which row to use">
          <input type="checkbox" checked={!!call.pickRow} onChange={(e) => togglePick(e.target.checked)} />
          <span>Ask me to pick a row</span>
        </label>
        {def && (
          <button type="button" className="link-btn small" onClick={onFillIn}>
            Fill in…
          </button>
        )}
      </div>
      {call.pickRow && (
        <div className="call-pick">
          <label className="field small">
            List
            <input type="text" className="mono" list={`lists-${call.id}`} value={call.pickRow.listPath} placeholder="$.items or $" onChange={(e) => onChange(setPickRow(tool, call.id, { ...call.pickRow!, listPath: e.target.value }))} spellCheck={false} />
          </label>
          <datalist id={`lists-${call.id}`}>
            {rowList.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <label className="field small">
            Shown when choosing
            <input type="text" className="mono" value={call.pickRow.labelPath} placeholder="$.name" onChange={(e) => onChange(setPickRow(tool, call.id, { ...call.pickRow!, labelPath: e.target.value }))} spellCheck={false} />
          </label>
        </div>
      )}
      {call.write && <p className="small muted">Runs only from an Action button.</p>}
    </li>
  );
}

function AddRequestPanel({ onAdd, onClose }: { onAdd: (r: PickableRequest) => void; onClose: () => void }) {
  const all = useMemo(() => listPickableRequests(), []);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = all.filter((r) => !q || `${r.path.join(" ")} ${r.request.method} ${r.request.url}`.toLowerCase().includes(q));
  return (
    <div className="add-request" role="region" aria-label="Add a saved request">
      <div className="add-request-head">
        <span className="add-request-title">Add a saved request</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close the list" title="Close the list (Esc)">
          ×
        </button>
      </div>
      <input
        className="search"
        type="search"
        placeholder="Search saved requests"
        aria-label="Search saved requests"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        autoFocus
      />
      <p className="muted small add-request-hint">Click a request to add it. The list stays open so you can add more; press Esc or Close when you are done.</p>
      {all.length === 0 && <p className="muted small">No saved requests yet. Save requests in the Requests section first.</p>}
      <ul className="add-request-list">
        {shown.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="add-request-row"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(REQUEST_DRAG_TYPE, r.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(r)}
              title="Click to add, or drag it into the Calls column. You can add the same request twice."
            >
              <span className={`method m-${r.request.method.toLowerCase()}`}>{r.request.method}</span>
              <span className="add-request-name">
                {r.isExample && <span className="muted">example: </span>}
                {r.path[r.path.length - 1]}
                {r.path.length > 1 && <span className="muted small"> · {r.path.slice(0, -1).join(" › ")}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
