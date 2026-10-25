import { useMemo, useState } from "react";
import { CONDITION_SOURCE_LABELS, OPS_FOR_CONDITION } from "../../lib/flows/conditions";
import { formatMs, NODE_TYPE_LABELS, nodeLabel } from "../../lib/flows/flows";
import type { FlowItems } from "../../lib/flows/items";
import type { ConditionSource, FlowCondition, FlowNode, RetrySettings } from "../../lib/flows/types";
import type { FlowProblem } from "../../lib/flows/validate";
import { OP_LABELS, opNeedsValue } from "../../lib/testing/assertions";

interface Props {
  node: FlowNode;
  items: FlowItems;
  problems: FlowProblem[];
  onChange: (node: FlowNode) => void;
  onDelete: () => void;
  onClose: () => void;
}

const SOURCES = Object.keys(CONDITION_SOURCE_LABELS) as ConditionSource[];

const PROPERTY_HINT: Partial<Record<ConditionSource, string>> = {
  header: "Header name, e.g. Content-Type",
  json: "Path, e.g. $.data[0].id",
  variable: "Variable name, e.g. token",
};

const EXPECTED_HINT: Partial<Record<ConditionSource, string>> = {
  status: "200 or 2xx",
  time: "500",
  size: "1024",
  "last-result": "passed or failed",
};

function NumberField({ label, value, onChange, min = 0, suffix }: { label: string; value: number; onChange: (n: number) => void; min?: number; suffix?: string }) {
  return (
    <label className="flow-field">
      <span>{label}</span>
      <span className="flow-field-row">
        <input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || 0)))} />
        {suffix && <span className="muted small">{suffix}</span>}
      </span>
    </label>
  );
}

function RetryEditor({ retry, onChange }: { retry: RetrySettings; onChange: (r: RetrySettings) => void }) {
  return (
    <fieldset className="flow-fieldset">
      <legend className="section-title">Retry</legend>
      <NumberField label="Extra tries" value={retry.times} onChange={(times) => onChange({ ...retry, times: Math.min(100, times) })} suffix={retry.times === 0 ? "off" : undefined} />
      {retry.times > 0 && <NumberField label="Wait between tries" value={retry.delayMs} onChange={(delayMs) => onChange({ ...retry, delayMs })} suffix={`ms (${formatMs(retry.delayMs)})`} />}
      <p className="muted small">When this step fails it is tried again, up to this many more times. Each try starts from the variables the step started with.</p>
    </fieldset>
  );
}

function ConditionEditor({ condition, onChange }: { condition: FlowCondition; onChange: (c: FlowCondition) => void }) {
  const set = (patch: Partial<FlowCondition>) => {
    const next = { ...condition, ...patch };
    if (patch.source && !OPS_FOR_CONDITION[patch.source].includes(next.op)) next.op = OPS_FOR_CONDITION[patch.source][0];
    if (patch.source === "last-result") next.expected = "passed";
    onChange(next);
  };
  return (
    <fieldset className="flow-fieldset">
      <legend className="section-title">Condition</legend>
      <label className="flow-field">
        <span>Check</span>
        <select value={condition.source} onChange={(e) => set({ source: e.target.value as ConditionSource })}>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {CONDITION_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {PROPERTY_HINT[condition.source] && (
        <label className="flow-field">
          <span>{condition.source === "variable" ? "Variable" : condition.source === "header" ? "Header" : "Path"}</span>
          <input value={condition.property} onChange={(e) => set({ property: e.target.value })} placeholder={PROPERTY_HINT[condition.source]} spellCheck={false} />
        </label>
      )}
      <label className="flow-field">
        <span>Condition</span>
        <select value={condition.op} onChange={(e) => set({ op: e.target.value as FlowCondition["op"] })}>
          {OPS_FOR_CONDITION[condition.source].map((op) => (
            <option key={op} value={op}>
              {OP_LABELS[op]}
            </option>
          ))}
        </select>
      </label>
      {opNeedsValue(condition.op) &&
        (condition.source === "last-result" ? (
          <label className="flow-field">
            <span>Value</span>
            <select value={condition.expected === "failed" ? "failed" : "passed"} onChange={(e) => set({ expected: e.target.value })}>
              <option value="passed">passed</option>
              <option value="failed">failed</option>
            </select>
          </label>
        ) : (
          <label className="flow-field">
            <span>Value</span>
            <input value={condition.expected} onChange={(e) => set({ expected: e.target.value })} placeholder={EXPECTED_HINT[condition.source] ?? "Value or {{variable}}"} spellCheck={false} />
          </label>
        ))}
      <p className="muted small">
        {condition.source === "variable"
          ? "Reads a flow variable, or an environment variable with that name."
          : condition.source === "last-result"
            ? "Whether the last Run step before this one passed or failed."
            : "Reads the response of the last Run step that got one. With nothing to check yet, the condition is false."}
      </p>
    </fieldset>
  );
}

/** A select over saved requests, with a search box when there are many. */
function RequestSelect({ items, value, onChange }: { items: FlowItems; value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => items.requests.filter((r) => r.id === value || !q || `${r.path.join(" ")} ${r.request.method} ${r.request.url}`.toLowerCase().includes(q)),
    [items.requests, q, value],
  );
  if (items.requests.length === 0) return <p className="muted small">No saved requests yet. Save one in Requests mode first.</p>;
  return (
    <>
      {items.requests.length > 8 && <input type="search" className="search" placeholder="Search name, folder or URL" value={query} onChange={(e) => setQuery(e.target.value)} />}
      <label className="flow-field">
        <span>Request</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Pick a saved request…</option>
          {shown.map((r) => (
            <option key={r.id} value={r.id}>
              {r.isExample ? "Example: " : ""}
              {r.path.join(" › ")} ({r.request.method})
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Settings for the selected node, in the right-hand panel. */
export function NodeSettings({ node, items, problems, onChange, onDelete, onClose }: Props) {
  const mine = problems.filter((p) => p.nodeId === node.id);
  const autoLabel = nodeLabel({ ...node, label: "" }, items.suites, items.findRequest);
  const suite = "suiteId" in node ? items.suites.find((s) => s.id === node.suiteId) : undefined;

  return (
    <aside className="flow-panel" aria-label="Step settings">
      <div className="flow-panel-head">
        <span className="section-title">{NODE_TYPE_LABELS[node.type]}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings" title="Close">
          ×
        </button>
      </div>

      {mine.map((p, i) => (
        <p key={i} className={`small flow-problem ${p.level}`}>
          {p.message}
        </p>
      ))}

      {node.type !== "note" && (
        <label className="flow-field">
          <span>Name</span>
          <input value={node.label ?? ""} placeholder={autoLabel} onChange={(e) => onChange({ ...node, label: e.target.value })} />
        </label>
      )}

      {node.type === "start" && <p className="muted small">A run begins here when you press Run. A flow has one Start.</p>}

      {(node.type === "run-case" || node.type === "run-suite") && (
        <label className="flow-field">
          <span>Suite</span>
          <select value={node.suiteId} onChange={(e) => onChange(node.type === "run-case" ? { ...node, suiteId: e.target.value, caseId: "" } : { ...node, suiteId: e.target.value })}>
            <option value="">Pick a suite…</option>
            {node.suiteId && !suite && <option value={node.suiteId}>(deleted suite)</option>}
            {items.suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || "(unnamed)"}
              </option>
            ))}
          </select>
        </label>
      )}
      {(node.type === "run-case" || node.type === "run-suite") && items.suites.length === 0 && <p className="muted small">No suites yet. Create one in Testing mode first.</p>}

      {node.type === "run-case" && suite && (
        <label className="flow-field">
          <span>Case</span>
          <select value={node.caseId} onChange={(e) => onChange({ ...node, caseId: e.target.value })}>
            <option value="">Pick a case…</option>
            {node.caseId && !suite.cases.some((c) => c.id === node.caseId) && <option value={node.caseId}>(deleted case)</option>}
            {suite.cases.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {c.name}
                {c.enabled ? "" : " (off)"}
              </option>
            ))}
          </select>
        </label>
      )}
      {node.type === "run-case" && <p className="muted small">Runs once with its scripts and assertions, using the suite's run settings. Edits to the case in Testing apply here too.</p>}
      {node.type === "run-suite" && <p className="muted small">Runs the whole suite as Run suite does in Testing: its run order, repeat and CSV data. Passes when every case passes.</p>}

      {node.type === "run-request" && (
        <>
          <RequestSelect items={items} value={node.requestId} onChange={(requestId) => onChange({ ...node, requestId })} />
          <p className="muted small">Runs with the request's own scripts. Passes when a response comes back and every rr.test passes; a 4xx/5xx alone does not fail it.</p>
        </>
      )}

      {(node.type === "run-case" || node.type === "run-suite" || node.type === "run-request") && <RetryEditor retry={node.retry} onChange={(retry) => onChange({ ...node, retry })} />}

      {node.type === "if" && <ConditionEditor condition={node.condition} onChange={(condition) => onChange({ ...node, condition })} />}

      {node.type === "wait" && <NumberField label="Wait" value={node.ms} onChange={(ms) => onChange({ ...node, ms })} suffix={`ms (${formatMs(node.ms)})`} />}

      {node.type === "set-var" && (
        <>
          <label className="flow-field">
            <span>Variable</span>
            <input value={node.name} onChange={(e) => onChange({ ...node, name: e.target.value })} placeholder="e.g. userId" spellCheck={false} />
          </label>
          <label className="flow-field">
            <span>Value</span>
            <input className="mono" value={node.value} onChange={(e) => onChange({ ...node, value: e.target.value })} placeholder="Text or {{placeholders}}" spellCheck={false} />
          </label>
          <p className="muted small">Later steps read it as {"{{name}}"} or rr.vars.get("name").</p>
        </>
      )}

      {node.type === "note" && (
        <>
          <label className="flow-field">
            <span>Text</span>
            <textarea rows={6} value={node.text} onChange={(e) => onChange({ ...node, text: e.target.value })} />
          </label>
          <p className="muted small">Sticky notes explain a flow. They are never run. Drag the top edge to move one, and the corners to resize it.</p>
        </>
      )}

      <div className="flow-panel-foot">
        <button className="secondary danger" onClick={onDelete}>
          Delete {node.type === "note" ? "note" : "step"}
        </button>
      </div>
    </aside>
  );
}
