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
import { listSource, resolveInputs, valueResolver } from "../../lib/tools/engine";
import { convertPickRow, listItems } from "../../lib/tools/lists";
import { addFoundList, fieldIsPicked, findLists, listOutline, mappingIsPicked, pickMappingPath, toggleListField, updateList } from "../../lib/tools/listBuilder";
import type { SessionState } from "../../lib/tools/session";
import { FIELD_FORMATS, type BlockField, type CallResult, type FieldFormat, type ListItemChoice, type PlaceholderMapping, type Tool, type ToolBlock, type ToolCall } from "../../lib/tools/types";
import { BADGE_COLOURS, requestLine, formatFieldValue, type BadgeColour } from "../../lib/tools/view";
import { listPickableRequests } from "../../lib/testing/requestSources";
import { Modal } from "../shell/Modal";
import { JsonTree } from "./JsonTree";
import { ChoiceEditor, RuleEditor } from "./ListControls";
import { RefBreadcrumb, RefSample, sampleOfRef } from "./ListValue";

/**
 * The Connect dialog: where a block gets its data, in four steps. 1. the saved request (a call), 2. where each
 * placeholder of that request is filled from, 3. the fields to show, clicked in a sample response, 4. each field's
 * label and format. Edits go to a copy of the tool and are kept only on Done.
 */

export type ConnectTarget = { blockId: string } | { callId: string };

type StepKey = "request" | "fill" | "fields" | "format" | "input" | "note";

const STEP_TITLES: Record<StepKey, string> = {
  request: "Request",
  fill: "Values",
  fields: "Fields",
  format: "Labels",
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
  const isLast = stepIndex === steps.length - 1;
  const connected = step !== "request" && call ? requestLine(findRequest(call.requestId)) : null;

  return (
    <Modal label={title} onClose={onCancel} className="connect-dialog">
      <div className="modal-head">
        <h3>{title}</h3>
        <button className="icon-btn" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>
      {steps.length > 1 && (
        <div className="cd-stepbar">
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
        {connected && (
          <span className="cd-request mono small muted" title={`${connected.method} ${connected.path}`}>
            <span className={`method m-${connected.method.toLowerCase()}`}>{connected.method}</span> {connected.path}
          </span>
        )}
        </div>
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
          <span className="muted small">Changes are kept when you finish.</span>
        )}
        {!isLast && blockers.length === 0 && !needsCall && (
          <button type="button" className="link-btn small" onClick={done}>
            Save and close
          </button>
        )}
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {stepIndex > 0 && (
          <button className="secondary" onClick={() => setStep(steps[stepIndex - 1])}>
            Back
          </button>
        )}
        {!isLast ? (
          <button className="primary-outline" onClick={() => setStep(steps[stepIndex + 1])} disabled={needsCall}>
            Next
          </button>
        ) : (
          <button className="primary-outline" onClick={done} disabled={blockers.length > 0}>
            Done
          </button>
        )}
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
      <p className="cd-lead">{action ? "Which write request does this button send?" : "Which request fills this block?"}</p>
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
        Where should each value in <strong>{call.name}</strong> come from?
      </p>
      <p className="small muted">Tried in order: input, another request, fixed text. If none has a value, the environment variable is used.</p>
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
                onChange={(e) => setSource("call", { callId: m!.call!.callId, path: e.target.value, ...(m!.call!.list ? { list: m!.call!.list } : {}) })}
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
                      isPicked={(p) => mappingIsPicked(srcCall, m!, srcSample, p)}
                      onPick={(p) => {
                        setWork((w) => pickMappingPath(w, call.id, placeholder, srcCall.id, srcSample, p));
                        setPicking(false);
                      }}
                    />
                  ) : (
                    <SampleStatus call={srcCall} state={state} onRunSample={onRunSample} />
                  )}
                </div>
              )}
              {m!.call!.list && srcCall && (
                <ListChoice work={work} setWork={setWork} source={srcCall} mapping={m!} state={state} placeholder={placeholder} call={call} />
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

/** Under a value that reads a list: which item it comes from, the path it takes, and what that reads in the sample. */
function ListChoice({ work, setWork, source, mapping, state, placeholder, call }: WorkProps & { source: ToolCall; mapping: PlaceholderMapping; state: SessionState; placeholder: string; call: ToolCall }) {
  const ref = mapping.call!.list!;
  const list = source.lists?.find((l) => l.id === ref.listId);
  const result = state.results[source.id];
  const items = list ? sampleItemsOf(source, list.id, result, work, state) : [];
  const setItem = (item: ListItemChoice | undefined) =>
    setWork((w) => ({
      ...w,
      calls: w.calls.map((c) => (c.id === call.id ? { ...c, mappings: { ...c.mappings, [placeholder]: { ...c.mappings[placeholder], call: { ...c.mappings[placeholder].call!, list: item ? { listId: ref.listId, item } : { listId: ref.listId } } } } } : c)),
    }));
  return (
    <div className="cd-list-choice">
      <p className="cd-lead small">
        Which {list ? list.name.toLowerCase() : "item"}?
      </p>
      {list ? (
        <ChoiceEditor ctx={{ tool: work, callId: source.id, items: items.slice(0, 1) }} listRule={list.choose} choice={ref.item} onChange={setItem} label={`${placeholder} from ${list.name}`} />
      ) : (
        <p className="small tone-bad">This list was removed. Pick the value again.</p>
      )}
      <p className="cd-crumb">
        <RefBreadcrumb tool={work} call={source} list={ref} path={mapping.call!.path} />
      </p>
      <p className="cd-sample">
        <RefSample tool={work} call={source} state={state} path={mapping.call!.path} list={ref} />
      </p>
    </div>
  );
}

function sampleItemsOf(source: ToolCall, listId: string, result: CallResult | undefined, work: Tool, state: SessionState): unknown[] {
  if (!result || result.state !== "done") return [];
  const resolve = valueResolver(work, resolveInputs(work, state.inputs), state.results);
  return listItems(listSource(source, result, resolve), listId);
}

// ---- 3. the fields ----

function StepFields({ work, setWork, block, setBlock, call, state, onRunSample, onStop }: WorkProps & { block: ToolBlock; setBlock: (b: ToolBlock) => void; call: ToolCall; state: SessionState; onRunSample: () => void; onStop: () => void }) {
  const result = state.results[call.id];
  const resolve = valueResolver(work, resolveInputs(work, state.inputs), state.results);
  const sample = blockSample(block, call, result, resolve);
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
        <p className="cd-lead">{table ? "Click values to use as columns" : single ? "Click the value to show" : block.type === "json" ? "Click a part of the response, or the top for all of it" : "Click the values to show"}</p>
        {table && <p className="small muted">Columns are read from each row of the list. This is the first row.</p>}
        {sample !== undefined ? (
          <JsonTree
            sample={sample}
            label="Sample response"
            rootLabel={table ? "Row" : "Whole response"}
            rootPickable={block.type === "json"}
            isPicked={(p) => (table || (block.type === "json" && p === "$") ? isPicked(block, p) : fieldIsPicked(call, block, sample, p))}
            onPick={(p) => {
              const inList = table ? null : toggleListField(work, block.id, sample, p);
              if (inList) setWork(inList);
              else setBlock(togglePath(block, p, sample));
            }}
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
            <p className="small muted">No sample response yet. Run with sample, then click the values you want.</p>
            <button className="secondary" onClick={onRunSample}>
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
            <li key={`${i}:${f.path}`} className={f.list ? "cd-picked-list" : undefined}>
              <code className="mono">{f.path}</code>
              {sample !== undefined && !f.list && <span className="muted small cd-picked-val">{formatFieldValue(sampleValue(sample, f.path), f.format)}</span>}
              <button type="button" className="icon-btn" aria-label={`Remove ${f.path}`} onClick={() => setBlock(removeField(block, i))}>
                ×
              </button>
              {f.list && <FieldListChoice work={work} setWork={setWork} block={block} index={i} call={call} state={state} />}
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
        {table && !call.pickRow && <TableList work={work} setWork={setWork} block={block} call={call} state={state} />}
        {table && (
          <label className="check small">
            <input
              type="checkbox"
              checked={block.expandable === true}
              onChange={(e) =>
                setWork((w) => ({ ...w, blocks: w.blocks.map((b) => (b.id === block.id ? withExpandable(b, e.target.checked) : b)) }))
              }
            />
            Rows expand
            <span className="muted"> Each row opens to show its other fields and the lists inside it.</span>
          </label>
        )}
        {table && (call.pickRow || !call.lists?.length) && (
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
                <button type="button" className="secondary use-lists" onClick={() => setWork(convertPickRow(work, call.id))} title="Turns this into a list set to Ask me to pick. Everything that reads this call keeps giving the same values.">
                  Use lists instead
                </button>
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

/** A table block's list: which list of the call it shows, and which item that list hands on. */
function TableList({ work, setWork, block, call, state }: WorkProps & { block: ToolBlock; call: ToolCall; state: SessionState }) {
  const result = state.results[call.id];
  const json = result?.state === "done" ? callJson(result) : undefined;
  const outline = listOutline(call, findLists(json));
  const list = block.listId !== undefined ? call.lists?.find((l) => l.id === block.listId) : undefined;
  const items = list ? sampleItemsOf(call, list.id, result, work, state) : [];
  const setBlockList = (listId: string | undefined) =>
    setWork((w) => ({ ...w, blocks: w.blocks.map((b) => (b.id === block.id ? withListId(b, listId) : b)) }));
  const choose = (value: string) => {
    if (value === "") return setBlockList(undefined);
    if (value.startsWith("found:")) {
      const f = outline.suggestions.find((x) => x.path === value.slice(6));
      if (!f) return;
      setWork((w) => {
        const r = addFoundList(w, call.id, f);
        return r.list ? { ...r.tool, blocks: r.tool.blocks.map((b) => (b.id === block.id ? withListId(b, r.list!.id) : b)) } : w;
      });
      return;
    }
    setBlockList(value);
  };
  if ((call.lists?.length ?? 0) === 0 && outline.suggestions.length === 0) return null;
  return (
    <div className="cd-table-list">
      <label className="field small">
        List
        <select value={block.listId !== undefined && list ? block.listId : ""} aria-label="List this table shows" onChange={(e) => choose(e.target.value)}>
          <option value="">First list in the response (as before)</option>
          {(call.lists ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          {outline.suggestions.map((f) => (
            <option key={f.path} value={`found:${f.path}`}>
              {f.name} ({f.size}) — add as a list
            </option>
          ))}
        </select>
      </label>
      {block.listId !== undefined && !list && <p className="small tone-bad">The list this table showed was removed. Choose another.</p>}
      {list && (
        <div className="cd-list-rule">
          <span className="small muted">Item to use</span>
          <RuleEditor ctx={{ tool: work, callId: call.id, items: items.slice(0, 1) }} rule={list.choose} label={list.name} onChange={(choose) => setWork((w) => updateList(w, call.id, list.id, { choose }))} />
          <p className="small muted">Other values can read from the item this picks. Ask me to pick shows a radio button on each row in Use mode.</p>
        </div>
      )}
    </div>
  );
}

function withExpandable(b: ToolBlock, on: boolean): ToolBlock {
  const copy = { ...b };
  if (on) copy.expandable = true;
  else delete copy.expandable;
  return copy;
}

function withListId(b: ToolBlock, listId: string | undefined): ToolBlock {
  const copy = { ...b };
  if (listId === undefined) delete copy.listId;
  else copy.listId = listId;
  return copy;
}

/** Under a field that sits in a list: which item it reads, the path it takes, and what that shows in the sample. */
function FieldListChoice({ work, setWork, block, index, call, state }: WorkProps & { block: ToolBlock; index: number; call: ToolCall; state: SessionState }) {
  const f = block.fields[index];
  const ref = f.list!;
  const list = call.lists?.find((l) => l.id === ref.listId);
  const result = state.results[call.id];
  const items = list ? sampleItemsOf(call, list.id, result, work, state) : [];
  const setItem = (item: ListItemChoice | undefined) =>
    setWork((w) => ({
      ...w,
      blocks: w.blocks.map((b) => (b.id === block.id ? { ...b, fields: b.fields.map((x, i) => (i === index ? { ...x, list: item ? { listId: ref.listId, item } : { listId: ref.listId } } : x)) } : b)),
    }));
  return (
    <div className="cd-list-choice">
      {list ? (
        <ChoiceEditor ctx={{ tool: work, callId: call.id, items: items.slice(0, 1) }} listRule={list.choose} choice={ref.item} onChange={setItem} label={`${f.label || f.path} from ${list.name}`} />
      ) : (
        <p className="small tone-bad">This list was removed. Pick the field again.</p>
      )}
      <p className="cd-crumb">
        <RefBreadcrumb tool={work} call={call} list={ref} path={f.path} />
      </p>
      <p className="cd-sample">
        <RefSample tool={work} call={call} state={state} path={f.path} list={ref} format={f.format} />
      </p>
    </div>
  );
}

// ---- 4. label and format ----

const FORMAT_LABELS: Record<FieldFormat, string> = { text: "Text", number: "Number", money: "Money", date: "Date", "yes-no": "Yes / no" };

function StepFormat({ work, block, setBlock, call, state }: { work: Tool; block: ToolBlock; setBlock: (b: ToolBlock) => void; call: ToolCall | undefined; state: SessionState }) {
  const resolve = valueResolver(work, resolveInputs(work, state.inputs), state.results);
  const sample = blockSample(block, call, call ? state.results[call.id] : undefined, resolve);
  const valueOf = (f: BlockField) => (f.list ? (sampleOfRef(work, call, state, f.path, f.list, f.format)?.text ?? "") : formatFieldValue(sampleValue(sample, f.path), f.format));
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
              <FieldRow key={`${i}:${f.path}`} f={f} i={i} count={block.fields.length} sample={sample} value={valueOf(f)} block={block} setBlock={setBlock} />
            ))}
          </ul>
        </>
      )}
      {block.type === "status" && <ColourMapEditor block={block} setBlock={setBlock} sample={sample} />}
    </div>
  );
}

function FieldRow({ f, i, count, sample, value, block, setBlock }: { f: BlockField; i: number; count: number; sample: unknown; value: string; block: ToolBlock; setBlock: (b: ToolBlock) => void }) {
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
