import { useMemo, useState } from "react";
import type { RequestLookup } from "../../lib/flows/flows";
import { requestPlaceholders } from "../../lib/request";
import { callJson } from "../../lib/tools/engine";
import {
  addCall,
  addFieldByPath,
  blockSample,
  blockLabel,
  colourEntries,
  colourMapText,
  humanize,
  isPicked,
  isSingleField,
  listPathOptions,
  guessLabelPath,
  mappingSources,
  moveField,
  pruneMappings,
  removeField,
  saveBlockers,
  sampleFor,
  sampleValue,
  setCallWrite,
  setMappingSource,
  setPickRow,
  sourceCalls,
  togglePath,
  uniqueName,
  updateField,
  usesFields,
  type SourceKind,
} from "../../lib/tools/builder";
import type { SessionState } from "../../lib/tools/session";
import { FIELD_FORMATS, type BlockField, type FieldFormat, type Tool, type ToolBlock, type ToolCall } from "../../lib/tools/types";
import { BADGE_COLOURS, requestLine, formatFieldValue, type BadgeColour } from "../../lib/tools/view";
import { listPickableRequests } from "../../lib/testing/requestSources";
import { Modal } from "../shell/Modal";
import { JsonTree } from "./JsonTree";

/**
 * The Connect dialog: where a block gets its data, in four steps. 1. the saved request (a call), 2. where each
 * placeholder of that request is filled from, 3. the fields to show, clicked in a sample response, 4. each field's
 * label and format. Edits go to a copy of the tool and are kept only on Done.
 */

export type ConnectTarget = { blockId: string } | { callId: string };

type StepKey = "request" | "fill" | "fields" | "format" | "input" | "note";

const STEP_TITLES: Record<StepKey, string> = {
  request: "Request",
  fill: "Fill in",
  fields: "Fields",
  format: "Format",
  input: "Input",
  note: "Note",
};

export function stepsFor(block: ToolBlock | undefined): StepKey[] {
  if (!block) return ["fill"];
  switch (block.type) {
    case "input":
      return ["input"];
    case "note":
      return ["note"];
    case "action":
      return ["request", "fill", "format"];
    default:
      return ["request", "fill", "fields", "format"];
  }
}

interface Props {
  tool: Tool;
  target: ConnectTarget;
  findRequest: RequestLookup;
  state: SessionState;
  onRunSample: (tool: Tool) => void;
  onStop: () => void;
  onCancel: () => void;
  onDone: (tool: Tool) => void;
}

export function ConnectDialog({ tool, target, findRequest, state, onRunSample, onStop, onCancel, onDone }: Props) {
  const [work, setWork] = useState<Tool>(tool);
  const blockId = "blockId" in target ? target.blockId : undefined;
  const block = blockId ? work.blocks.find((b) => b.id === blockId) : undefined;
  const steps = stepsFor(block);
  const [step, setStep] = useState<StepKey>(steps[0]);
  const callId = block ? block.callId : "callId" in target ? target.callId : undefined;
  const call = work.calls.find((c) => c.id === callId);
  const stepIndex = Math.max(0, steps.indexOf(step));
  const blockers = saveBlockers(work, findRequest);

  const setBlock = (b: ToolBlock) => setWork((w) => ({ ...w, blocks: w.blocks.map((x) => (x.id === b.id ? b : x)) }));
  const done = () => {
    let next = work;
    const def = call ? findRequest(call.requestId) : null;
    if (call && def) next = { ...next, calls: next.calls.map((c) => (c.id === call.id ? pruneMappings(c, requestPlaceholders(def)) : c)) };
    onDone(next);
  };

  const title = block ? `Connect ${blockLabel(block.type).toLowerCase()} block` : `Fill in ${call?.name ?? "call"}`;
  const needsCall = steps.includes("request") && !call;

  return (
    <Modal label={title} onClose={onCancel} className="connect-dialog">
      <div className="modal-head">
        <h3>{title}</h3>
        <button className="icon-btn" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>
      {steps.length > 1 && (
        <ol className="cd-steps" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s} className={s === step ? "on" : i < stepIndex ? "past" : ""}>
              <button type="button" onClick={() => setStep(s)} aria-current={s === step ? "step" : undefined} disabled={i > 0 && needsCall}>
                <span className="cd-step-num">{i + 1}</span>
                {STEP_TITLES[s]}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="cd-body">
        {step === "request" && block && <StepRequest work={work} setWork={setWork} block={block} setBlock={setBlock} findRequest={findRequest} />}
        {step === "fill" && call && <StepFill work={work} setWork={setWork} call={call} findRequest={findRequest} state={state} onRunSample={() => onRunSample(work)} />}
        {step === "fields" && block && call && <StepFields work={work} setWork={setWork} block={block} setBlock={setBlock} call={call} state={state} onRunSample={() => onRunSample(work)} onStop={onStop} />}
        {step === "format" && block && <StepFormat work={work} block={block} setBlock={setBlock} call={call} state={state} />}
        {step === "input" && block && <StepInput work={work} setWork={setWork} block={block} setBlock={setBlock} />}
        {step === "note" && block && <StepNote block={block} setBlock={setBlock} />}
        {(step === "fill" || step === "fields") && !call && <p className="muted">Choose a request first.</p>}
      </div>
      <div className="modal-foot cd-foot">
        {blockers.length > 0 ? (
          <span className="small tone-bad" role="alert">
            {blockers[0].message}
          </span>
        ) : (
          <span className="muted small">Changes are kept when you press Done. Save the tool to keep them for good.</span>
        )}
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {stepIndex > 0 && (
          <button className="secondary" onClick={() => setStep(steps[stepIndex - 1])}>
            Back
          </button>
        )}
        {stepIndex < steps.length - 1 && (
          <button className="send" onClick={() => setStep(steps[stepIndex + 1])} disabled={needsCall}>
            Next
          </button>
        )}
        <button className={stepIndex < steps.length - 1 ? "secondary" : "send"} onClick={done} disabled={blockers.length > 0}>
          Done
        </button>
      </div>
    </Modal>
  );
}

// ---- 1. the request ----

interface WorkProps {
  work: Tool;
  setWork: (t: Tool | ((t: Tool) => Tool)) => void;
}

function StepRequest({ work, setWork, block, setBlock, findRequest }: WorkProps & { block: ToolBlock; setBlock: (b: ToolBlock) => void; findRequest: RequestLookup }) {
  const all = useMemo(() => listPickableRequests(), []);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(work.calls.length === 0);
  const q = query.trim().toLowerCase();
  const shown = all.filter((r) => !q || `${r.path.join(" ")} ${r.request.method} ${r.request.url}`.toLowerCase().includes(q));
  const action = block.type === "action";
  const call = work.calls.find((c) => c.id === block.callId);

  const choose = (c: ToolCall) => setBlock({ ...block, callId: c.id, fields: block.callId === c.id ? block.fields : [] });
  const addRequest = (r: (typeof all)[number]) => {
    const { tool, call: added } = addCall(work, { id: r.id, name: r.request.name || r.path[r.path.length - 1], method: r.request.method });
    setWork({ ...tool, blocks: tool.blocks.map((b) => (b.id === block.id ? { ...b, callId: added.id, fields: [] } : b)) });
    setAdding(false);
  };

  return (
    <div className="cd-pane">
      <p className="cd-lead">{action ? "Which write request does this button run?" : "Which request fills this block?"}</p>
      {work.calls.length > 0 && (
        <ul className="cd-calls" role="radiogroup" aria-label="Requests in this tool">
          {work.calls.map((c) => {
            const def = findRequest(c.requestId);
            const line = requestLine(def);
            return (
              <li key={c.id}>
                <label className={block.callId === c.id ? "on" : ""}>
                  <input type="radio" name="cd-call" checked={block.callId === c.id} onChange={() => choose(c)} />
                  <span className="cd-call-name">{c.name || "(unnamed)"}</span>
                  {line ? (
                    <span className="mono small muted">
                      <span className={`method m-${line.method.toLowerCase()}`}>{line.method}</span> {line.path}
                    </span>
                  ) : (
                    <span className="small tone-bad">Request missing</span>
                  )}
                  {c.write && <span className="cd-tag">Write</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {action && call && !call.write && (
        <p className="small tone-warn cd-note">
          This is a lookup call, so it runs with Look up. Action buttons run write requests.{" "}
          <button className="link-btn" onClick={() => setWork(setCallWrite(work, call.id, true))}>
            Make it a write call
          </button>
        </p>
      )}
      {!adding ? (
        <button className="secondary cd-add" onClick={() => setAdding(true)}>
          Add another saved request
        </button>
      ) : (
        <div className="cd-picker">
          <input className="search" type="search" placeholder="Search name, folder or URL" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus aria-label="Search saved requests" />
          {all.length === 0 && <p className="muted small">No saved requests yet. Save requests in the Requests section first.</p>}
          <ul className="picker-list cd-picker-list">
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" className="cd-pick-row" onClick={() => addRequest(r)}>
                  <span className={`method m-${r.request.method.toLowerCase()}`}>{r.request.method}</span>
                  <span className="picker-name">
                    {r.path.slice(0, -1).map((p, i) => (
                      <span key={i} className="muted">
                        {p} ›{" "}
                      </span>
                    ))}
                    {r.isExample && <span className="muted">example: </span>}
                    {r.path[r.path.length - 1]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- 2. filling in placeholders ----

function SampleStatus({ call, state, onRunSample }: { call: ToolCall; state: SessionState; onRunSample: () => void }) {
  const result = state.results[call.id];
  if (result?.state === "done") return null;
  return (
    <div className="cd-sample-help">
      <p className="small muted">
        {result?.message ?? result?.error ?? (state.running ? "Running with sample values…" : "No sample response yet. Run with sample to fetch one and click the fields you want.")}
      </p>
      <button className="secondary" onClick={onRunSample} disabled={state.running}>
        Run with sample
      </button>
    </div>
  );
}

function StepFill({ work, setWork, call, findRequest, state, onRunSample }: WorkProps & { call: ToolCall; findRequest: RequestLookup; state: SessionState; onRunSample: () => void }) {
  const def = findRequest(call.requestId);
  if (!def) {
    return (
      <div className="cd-pane">
        <p className="tone-bad">Request missing. The saved request this call used was deleted. Remove the call in the Calls column and add another.</p>
      </div>
    );
  }
  const placeholders = requestPlaceholders(def);
  return (
    <div className="cd-pane">
      <p className="cd-lead">
        Where does each value of <strong>{call.name}</strong> come from?
      </p>
      <p className="small muted">Sources are tried in this order: input, another request's field, fixed text. If none has a value, the environment's variable is used.</p>
      {placeholders.length === 0 && <p className="muted">This request has nothing to fill in.</p>}
      <ul className="cd-maps">
        {placeholders.map((p) => (
          <li key={p}>
            <MappingEditor work={work} setWork={setWork} call={call} placeholder={p} findRequest={findRequest} state={state} onRunSample={onRunSample} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MappingEditor({ work, setWork, call, placeholder, findRequest, state, onRunSample }: WorkProps & { call: ToolCall; placeholder: string; findRequest: RequestLookup; state: SessionState; onRunSample: () => void }) {
  const m = call.mappings[placeholder];
  const kinds = mappingSources(m);
  const sources = sourceCalls(work, call.id, findRequest);
  const [picking, setPicking] = useState(false);
  const patch = (next: ToolCall) => setWork((w) => ({ ...w, calls: w.calls.map((c) => (c.id === call.id ? next : c)) }));
  const setSource = (kind: SourceKind, value: string | { callId: string; path: string } | null) =>
    patch(setMappingSource(call, placeholder, kind, value));

  const newInput = () => {
    const name = uniqueName(placeholder, work.inputs.map((i) => i.name));
    setWork({
      ...work,
      inputs: [...work.inputs, { name, label: humanize(placeholder), kind: "text" }],
      calls: work.calls.map((c) => (c.id === call.id ? setMappingSource(c, placeholder, "input", name) : c)),
    });
  };
  const addSource = (kind: SourceKind) => {
    if (kind === "input") {
      if (work.inputs.length === 0) newInput();
      else setSource("input", (work.inputs.find((i) => i.name === placeholder) ?? work.inputs[0]).name);
    } else if (kind === "call") setSource("call", { callId: sources[0].id, path: "" });
    else setSource("fixed", "");
  };
  const labels: Record<SourceKind, string> = { input: "An input", call: "Another request's field", fixed: "Fixed text" };
  const absent = (["input", "call", "fixed"] as SourceKind[]).filter((k) => !kinds.includes(k));
  const srcCall = m?.call ? work.calls.find((c) => c.id === m.call!.callId) : undefined;
  const srcSample = srcCall ? sampleFor(srcCall, state.results[srcCall.id]) : undefined;

  return (
    <div className="cd-map">
      <div className="cd-map-head">
        <code className="cd-ph">{`{{${placeholder}}}`}</code>
        {kinds.length === 0 && <span className="muted small">Not mapped: uses the environment variable of the same name.</span>}
      </div>
      {kinds.map((k, i) => (
        <div key={k} className="cd-slot">
          <span className="cd-slot-label muted small">{i === 0 ? "Use" : "else use"}</span>
          {k === "input" && (
            <select
              value={m!.input ?? ""}
              aria-label={`Input for ${placeholder}`}
              onChange={(e) => (e.target.value === "__new" ? newInput() : setSource("input", e.target.value))}
            >
              {!work.inputs.some((x) => x.name === m!.input) && <option value={m!.input}>{m!.input || "(choose an input)"}</option>}
              {work.inputs.map((x) => (
                <option key={x.name} value={x.name}>
                  Input: {x.label || x.name}
                </option>
              ))}
              <option value="__new">New input named {placeholder}…</option>
            </select>
          )}
          {k === "call" && (
            <div className="cd-call-slot">
              <select
                value={m!.call!.callId}
                aria-label={`Request to read for ${placeholder}`}
                onChange={(e) => {
                  setSource("call", { callId: e.target.value, path: m!.call!.path });
                  setPicking(false);
                }}
              >
                {!sources.some((c) => c.id === m!.call!.callId) && <option value={m!.call!.callId}>{srcCall?.name ?? "(a removed request)"}</option>}
                {sources.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="mono"
                value={m!.call!.path}
                placeholder="$.account.id"
                aria-label={`Field of the other request for ${placeholder}`}
                spellCheck={false}
                onChange={(e) => setSource("call", { callId: m!.call!.callId, path: e.target.value })}
              />
              <button type="button" className="secondary" onClick={() => setPicking(!picking)} aria-expanded={picking}>
                Pick from sample
              </button>
              {picking && srcCall && (
                <div className="cd-inline-tree">
                  {srcSample !== undefined ? (
                    <JsonTree
                      sample={srcSample}
                      label={`Fields of ${srcCall.name}`}
                      isPicked={(p) => p === m!.call!.path}
                      onPick={(p) => {
                        setSource("call", { callId: srcCall.id, path: p });
                        setPicking(false);
                      }}
                    />
                  ) : (
                    <SampleStatus call={srcCall} state={state} onRunSample={onRunSample} />
                  )}
                </div>
              )}
              <p className="small muted cd-skip-note">If this field has no value, the request is skipped.{srcCall?.pickRow ? " It is read from the row you pick." : ""}</p>
            </div>
          )}
          {k === "fixed" && <input type="text" value={m!.fixed ?? ""} aria-label={`Fixed text for ${placeholder}`} placeholder="Text to send" onChange={(e) => setSource("fixed", e.target.value)} spellCheck={false} />}
          <button type="button" className="icon-btn" aria-label={`Remove ${labels[k].toLowerCase()} for ${placeholder}`} title="Remove" onClick={() => setSource(k, null)}>
            ×
          </button>
        </div>
      ))}
      <div className="cd-add-source">
        {absent.map((k) => (
          <button key={k} type="button" className="link-btn small" disabled={k === "call" && sources.length === 0} title={k === "call" && sources.length === 0 ? "No other request to read from" : undefined} onClick={() => addSource(k)}>
            {kinds.length === 0 ? `Use ${labels[k].toLowerCase()}` : `+ ${kinds.length > 0 ? "Fallback: " : ""}${labels[k].toLowerCase()}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- 3. the fields ----

function StepFields({ work, setWork, block, setBlock, call, state, onRunSample, onStop }: WorkProps & { block: ToolBlock; setBlock: (b: ToolBlock) => void; call: ToolCall; state: SessionState; onRunSample: () => void; onStop: () => void }) {
  const result = state.results[call.id];
  const sample = blockSample(block, call, result);
  const [path, setPath] = useState("");
  const pickingRow = state.pending.some((p) => p.callId === call.id);
  const table = block.type === "table";
  const lists = result?.state === "done" ? listPathOptions(callJson(result)) : [];
  const single = isSingleField(block.type);

  const toggleAskRow = (on: boolean) => {
    const json = result?.state === "done" ? callJson(result) : undefined;
    const list = lists[0] ?? "$";
    const row = Array.isArray(json) ? json[0] : (json as Record<string, unknown> | undefined)?.[list.replace(/^\$\./, "")];
    setWork(setPickRow(work, call.id, on ? { listPath: call.pickRow?.listPath ?? list, labelPath: call.pickRow?.labelPath ?? guessLabelPath(Array.isArray(row) ? row[0] : row) } : null));
  };

  return (
    <div className="cd-pane cd-fields">
      <div className="cd-fields-tree">
        <p className="cd-lead">{table ? "Click the values to show as columns" : single ? "Click the value to show" : block.type === "json" ? "Click a part of the response, or the top for all of it" : "Click the values to show"}</p>
        {table && <p className="small muted">Columns are read from each row of the list. This is the first row.</p>}
        {sample !== undefined ? (
          <JsonTree
            sample={sample}
            label="Sample response"
            rootLabel={table ? "Row" : "Whole response"}
            rootPickable={block.type === "json"}
            isPicked={(p) => isPicked(block, p)}
            onPick={(p) => setBlock(togglePath(block, p, sample))}
          />
        ) : result && result.state !== "done" ? (
          <div className="cd-sample-help">
            <p className="small tone-warn">{result.message ?? result.error ?? "No response."}</p>
            <button className="secondary" onClick={onRunSample} disabled={state.running}>
              Run with sample again
            </button>
          </div>
        ) : state.running ? (
          <div className="cd-sample-help">
            <p className="small muted" role="status">
              {pickingRow ? "Waiting for you to pick a row. Pick one in the block page behind this dialog, or press Stop." : "Running with sample values…"}
            </p>
            <button className="secondary" onClick={onStop}>
              Stop
            </button>
          </div>
        ) : result?.state === "done" && table ? (
          <p className="small muted">The response has no list to read rows from.</p>
        ) : (
          <div className="cd-sample-help">
            <p className="small muted">No sample response yet. Run with sample to fetch real answers, then click the values you want.</p>
            <button className="send" onClick={onRunSample}>
              Run with sample
            </button>
          </div>
        )}
      </div>
      <div className="cd-fields-picked">
        <p className="cd-lead">{single ? "Showing" : `Showing ${block.fields.length === 0 ? "nothing yet" : block.fields.length === 1 ? "1 field" : `${block.fields.length} fields`}`}</p>
        {block.type === "json" && block.fields.length === 0 && <p className="small">The whole response.</p>}
        <ul className="cd-picked">
          {block.fields.map((f, i) => (
            <li key={f.path}>
              <code className="mono">{f.path}</code>
              {sample !== undefined && <span className="muted small cd-picked-val">{formatFieldValue(sampleValue(sample, f.path), f.format)}</span>}
              <button type="button" className="icon-btn" aria-label={`Remove ${f.path}`} onClick={() => setBlock(removeField(block, i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {usesFields(block.type) && (
          <form
            className="cd-add-path"
            onSubmit={(e) => {
              e.preventDefault();
              setBlock(addFieldByPath(block, path, sample));
              setPath("");
            }}
          >
            <input type="text" className="mono" placeholder={single ? "$.status" : "Or type a path, e.g. $.account.id"} value={path} onChange={(e) => setPath(e.target.value)} aria-label="Type a path" spellCheck={false} />
            <button type="submit" className="secondary" disabled={!path.trim()}>
              {single ? "Use" : "Add"}
            </button>
          </form>
        )}
        {table && (
          <div className="cd-rows-setting">
            <label className="check">
              <input type="checkbox" checked={!!call.pickRow} onChange={(e) => toggleAskRow(e.target.checked)} />
              <span>Ask me to pick a row</span>
            </label>
            <p className="small muted">The lookup waits for you to choose one row; other requests can read fields from that row.</p>
            {call.pickRow && (
              <div className="cd-pickrow">
                <label className="field small">
                  List
                  <input type="text" className="mono" list="cd-lists" value={call.pickRow.listPath} placeholder="$.items or $" onChange={(e) => setWork(setPickRow(work, call.id, { ...call.pickRow!, listPath: e.target.value }))} spellCheck={false} />
                </label>
                <datalist id="cd-lists">
                  {lists.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
                <label className="field small">
                  Shown when choosing
                  <input type="text" className="mono" value={call.pickRow.labelPath} placeholder="$.name" onChange={(e) => setWork(setPickRow(work, call.id, { ...call.pickRow!, labelPath: e.target.value }))} spellCheck={false} />
                </label>
              </div>
            )}
          </div>
        )}
        {result?.state === "done" && (
          <button className="link-btn small" onClick={onRunSample} disabled={state.running}>
            Run with sample again
          </button>
        )}
      </div>
    </div>
  );
}

// ---- 4. label and format ----

const FORMAT_LABELS: Record<FieldFormat, string> = { text: "Text", number: "Number", money: "Money", date: "Date", "yes-no": "Yes / no" };

function StepFormat({ work, block, setBlock, call, state }: { work: Tool; block: ToolBlock; setBlock: (b: ToolBlock) => void; call: ToolCall | undefined; state: SessionState }) {
  const sample = blockSample(block, call, call ? state.results[call.id] : undefined);
  const callName = work.calls.find((c) => c.id === block.callId)?.name;
  const action = block.type === "action";
  return (
    <div className="cd-pane">
      <label className="field">
        {action ? "Button text" : "Block title"}
        <input type="text" value={block.title} placeholder={callName ?? ""} onChange={(e) => setBlock({ ...block, title: e.target.value })} />
      </label>
      {action && (
        <label className="field">
          Confirm text (optional)
          <input type="text" value={block.text ?? ""} placeholder="Suspend this subscriber?" onChange={(e) => setBlock({ ...block, text: e.target.value })} />
          <span className="small muted">Asked before the button sends. On an environment marked as production it always asks, with or without text.</span>
        </label>
      )}
      {block.type === "json" && <p className="small muted">A JSON block shows the response as it came. There is nothing to format.</p>}
      {block.type === "number" && (
        <label className="field">
          Unit
          <input type="text" value={block.text ?? ""} placeholder="USD, GB, days…" onChange={(e) => setBlock({ ...block, text: e.target.value })} />
        </label>
      )}
      {usesFields(block.type) && block.type !== "json" && (
        <>
          {block.fields.length === 0 && <p className="muted">No fields picked yet. Go back to Fields and click the values to show.</p>}
          <ul className="cd-format">
            {block.fields.map((f, i) => (
              <FieldRow key={f.path} f={f} i={i} count={block.fields.length} sample={sample} block={block} setBlock={setBlock} />
            ))}
          </ul>
        </>
      )}
      {block.type === "status" && <ColourMapEditor block={block} setBlock={setBlock} sample={sample} />}
    </div>
  );
}

function FieldRow({ f, i, count, sample, block, setBlock }: { f: BlockField; i: number; count: number; sample: unknown; block: ToolBlock; setBlock: (b: ToolBlock) => void }) {
  const value = formatFieldValue(sampleValue(sample, f.path), f.format);
  const column = block.type === "table";
  return (
    <li className="cd-format-row">
      <div className="cd-format-main">
        <input type="text" value={f.label} aria-label={`${column ? "Column heading" : "Label"} for ${f.path}`} placeholder={f.path} onChange={(e) => setBlock(updateField(block, i, { label: e.target.value }))} />
        <select value={f.format} aria-label={`Format of ${f.path}`} onChange={(e) => setBlock(updateField(block, i, { format: e.target.value as FieldFormat }))}>
          {FIELD_FORMATS.map((fm) => (
            <option key={fm} value={fm}>
              {FORMAT_LABELS[fm]}
            </option>
          ))}
        </select>
        {count > 1 && (
          <span className="cd-move">
            <button type="button" className="icon-btn" disabled={i === 0} aria-label={`Move ${f.label || f.path} up`} onClick={() => setBlock(moveField(block, i, i - 1))}>
              ↑
            </button>
            <button type="button" className="icon-btn" disabled={i === count - 1} aria-label={`Move ${f.label || f.path} down`} onClick={() => setBlock(moveField(block, i, i + 1))}>
              ↓
            </button>
          </span>
        )}
      </div>
      <div className="cd-format-hint small muted">
        <code className="mono">{f.path}</code>
        {sample !== undefined && <span> shows {value}</span>}
      </div>
    </li>
  );
}

function ColourMapEditor({ block, setBlock, sample }: { block: ToolBlock; setBlock: (b: ToolBlock) => void; sample: unknown }) {
  // Rows being typed (still empty) are kept here; the block's text only holds finished lines.
  const [rows, setRows] = useState(() => colourEntries(block.text));
  const commit = (next: typeof rows) => {
    setRows(next);
    setBlock({ ...block, text: colourMapText(next) });
  };
  const current = block.fields[0] ? sampleValue(sample, block.fields[0].path) : undefined;
  const suggestion = current !== undefined && current !== null && typeof current !== "object" ? String(current) : "";
  return (
    <fieldset className="cd-colours">
      <legend>Colours</legend>
      <p className="small muted">Each value the status can have, and the colour of its badge. Anything not listed is grey.</p>
      {rows.map((r, i) => (
        <div key={i} className="cd-colour-row">
          <input type="text" value={r.value} placeholder="active" aria-label="Status value" onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <select value={r.colour} aria-label={`Colour for ${r.value || "value"}`} onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, colour: e.target.value as BadgeColour } : x)))}>
            {BADGE_COLOURS.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
          <span className={`tool-badge badge-${r.colour}`}>{r.value || "…"}</span>
          <button type="button" className="icon-btn" aria-label={`Remove ${r.value || "value"}`} onClick={() => commit(rows.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <div className="cd-colour-add">
        <button type="button" className="secondary" onClick={() => setRows([...rows, { value: "", colour: "green" }])}>
          Add a value
        </button>
        {suggestion && !rows.some((r) => r.value.toLowerCase() === suggestion.toLowerCase()) && (
          <button type="button" className="link-btn small" onClick={() => commit([...rows, { value: suggestion, colour: "green" }])}>
            Add “{suggestion}” from the sample
          </button>
        )}
      </div>
    </fieldset>
  );
}

// ---- input and note blocks ----

function StepInput({ work, setWork, block, setBlock }: WorkProps & { block: ToolBlock; setBlock: (b: ToolBlock) => void }) {
  const createInput = () => {
    const name = uniqueName("input", work.inputs.map((i) => i.name));
    setWork({ ...work, inputs: [...work.inputs, { name, label: name, kind: "text" }], blocks: work.blocks.map((b) => (b.id === block.id ? { ...b, inputName: name } : b)) });
  };
  return (
    <div className="cd-pane">
      <label className="field">
        Which input does this box edit?
        <select value={block.inputName ?? ""} onChange={(e) => (e.target.value === "__new" ? createInput() : setBlock({ ...block, inputName: e.target.value || undefined }))}>
          <option value="">(choose an input)</option>
          {work.inputs.map((i) => (
            <option key={i.name} value={i.name}>
              {i.label || i.name}
            </option>
          ))}
          <option value="__new">New input…</option>
        </select>
      </label>
      <label className="field">
        Heading (optional)
        <input type="text" value={block.title} onChange={(e) => setBlock({ ...block, title: e.target.value })} />
      </label>
      <p className="small muted">Name, label, dropdown choices and default are edited in the tool's Settings.</p>
    </div>
  );
}

function StepNote({ block, setBlock }: { block: ToolBlock; setBlock: (b: ToolBlock) => void }) {
  return (
    <div className="cd-pane">
      <label className="field">
        Heading (optional)
        <input type="text" value={block.title} onChange={(e) => setBlock({ ...block, title: e.target.value })} autoFocus />
      </label>
      <label className="field">
        Text
        <textarea rows={5} value={block.text ?? ""} onChange={(e) => setBlock({ ...block, text: e.target.value })} />
      </label>
    </div>
  );
}
