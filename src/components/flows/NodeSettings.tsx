import { useMemo, useRef, useState } from "react";
import { parseCsv } from "../../lib/csv";
import { CONDITION_SOURCE_LABELS, OPS_FOR_CONDITION } from "../../lib/flows/conditions";
import { formatMs, NODE_TYPE_LABELS, nodeLabel } from "../../lib/flows/flows";
import type { FlowItems } from "../../lib/flows/items";
import { nextDueAfter, scheduleProblem, WEEKDAY_NAMES, type Schedule, type ScheduleState } from "../../lib/flows/schedule";
import type { ConditionSource, FlowCondition, FlowNode, LoopNode, RetrySettings, ScheduleNode } from "../../lib/flows/types";
import type { FlowProblem } from "../../lib/flows/validate";
import { OP_LABELS, opNeedsValue } from "../../lib/testing/assertions";
import { useEscape } from "../useEscape";

interface Props {
  node: FlowNode;
  items: FlowItems;
  problems: FlowProblem[];
  /** What the scheduler remembers about this Schedule step, if it is one. */
  scheduleState?: ScheduleState;
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

/** Loop over CSV: load a file; the rows and columns are shown. */
function LoopEditor({ node, onChange }: { node: LoopNode; onChange: (n: LoopNode) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const csv = useMemo(() => (node.data ? parseCsv(node.data.text) : null), [node.data]);
  const load = async (file: File) => {
    setError(null);
    const text = await file.text();
    if (parseCsv(text).headers.length === 0) {
      setError(`${file.name} has no header row.`);
      return;
    }
    if (text.length > MAX_LOOP_CSV) setError(`${file.name} is large and may not fit in local storage with your other flows.`);
    onChange({ ...node, data: { name: file.name, text } });
  };
  return (
    <fieldset className="flow-fieldset">
      <legend className="section-title">CSV data</legend>
      {csv && node.data ? (
        <p className="small">
          <strong>{node.data.name}</strong>: {csv.rows.length} row{csv.rows.length === 1 ? "" : "s"}, columns{" "}
          <span className="mono">{csv.headers.map((h) => `{{${h}}}`).join(" ")}</span>
        </p>
      ) : (
        <p className="muted small">No CSV loaded yet.</p>
      )}
      {csv && csv.warnings.length > 0 && <p className="small warning">{csv.warnings.join(" ")}</p>}
      {error && <p className="small warning">{error}</p>}
      <span className="flow-field-row">
        <button className="secondary" onClick={() => inputRef.current?.click()}>
          {node.data ? "Replace CSV…" : "Load CSV…"}
        </button>
        {node.data && (
          <button className="link-btn" onClick={() => onChange({ ...node, data: null })}>
            Remove
          </button>
        )}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = "";
        }}
      />
      <p className="muted small">
        The steps wired to "each row" run once per row, one row at a time. Their requests, scripts and Set variable steps can use the columns as {"{{column}}"} and rr.data. Flow variables carry from one row to the next. When every row has run, the flow continues from "done"; if a row failed with nothing wired to handle it, the flow stops as failed instead.
      </p>
    </fieldset>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

/** Monday first, as most calendars show it. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function ScheduleEditor({ node, state, onChange }: { node: ScheduleNode; state?: ScheduleState; onChange: (n: FlowNode) => void }) {
  const s = node.schedule;
  const set = (schedule: Schedule) => onChange({ ...node, schedule });
  const time = s.kind === "interval" ? "09:00" : s.time;
  const problem = scheduleProblem(s);
  const next = node.enabled && !problem ? nextDueAfter(s, new Date()) : null;
  return (
    <fieldset className="flow-fieldset">
      <legend className="section-title">When</legend>
      <label className="check small">
        <input type="checkbox" checked={node.enabled} onChange={(e) => onChange({ ...node, enabled: e.target.checked })} />
        Run on this schedule
      </label>
      <label className="flow-field">
        <span>Repeat</span>
        <select
          value={s.kind}
          onChange={(e) => {
            const kind = e.target.value as Schedule["kind"];
            if (kind === "interval") set({ kind, minutes: 60 });
            else if (kind === "daily") set({ kind, time });
            else set({ kind, time, days: [1, 2, 3, 4, 5] });
          }}
        >
          <option value="interval">Every N minutes</option>
          <option value="daily">Every day</option>
          <option value="weekdays">On chosen days</option>
        </select>
      </label>
      {s.kind === "interval" && <NumberField label="Every" value={s.minutes} min={1} onChange={(minutes) => set({ ...s, minutes })} suffix="minutes" />}
      {s.kind !== "interval" && (
        <label className="flow-field">
          <span>At</span>
          <input type="time" value={s.time} onChange={(e) => set({ ...s, time: e.target.value })} />
        </label>
      )}
      {s.kind === "weekdays" && (
        <div className="flow-weekdays" role="group" aria-label="Days">
          {WEEK_ORDER.map((d) => (
            <label key={d} className="check small">
              <input
                type="checkbox"
                checked={s.days.includes(d)}
                onChange={(e) => set({ ...s, days: e.target.checked ? [...s.days, d].sort() : s.days.filter((x) => x !== d) })}
              />
              {WEEKDAY_NAMES[d]}
            </label>
          ))}
        </div>
      )}
      {problem && <p className="small flow-problem error">{problem}</p>}
      {next && <p className="small">Next run: {when(next.toISOString())}</p>}
      {state?.ranDue && <p className="muted small">Last ran: {when(state.ranDue)}</p>}
      {state?.skipped && (
        <p className="small tone-warn">
          Skipped the {when(state.skipped.due)} run: {state.skipped.reason}.
        </p>
      )}
      <p className="muted small">
        {s.kind === "interval" ? "Counts from midnight, so every 15 minutes means :00, :15, :30 and :45. " : ""}
        Uses this computer's time and the environment picked in the top bar. Runs only while REST Runner is open; a run missed while it was closed, or one that comes due while the flow is still running, is skipped and noted here.
      </p>
    </fieldset>
  );
}

/** CSV files above this size may not fit in local storage. */
const MAX_LOOP_CSV = 2 * 1024 * 1024;

/** Settings for the selected node, in the right-hand panel. */
export function NodeSettings({ node, items, problems, scheduleState, onChange, onDelete, onClose }: Props) {
  useEscape(onClose);
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
      {node.type === "schedule" && <ScheduleEditor node={node} state={scheduleState} onChange={onChange} />}

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
          <label className="check">
            <input type="checkbox" checked={node.httpErrorsFail !== false} onChange={(e) => onChange({ ...node, httpErrorsFail: e.target.checked })} />
            4xx/5xx counts as failed
          </label>
          <p className="muted small">
            Runs with the request's own scripts. Passes when a response comes back and every rr.test passes
            {node.httpErrorsFail !== false ? ", and the status is below 400." : ". With the switch off, a 4xx/5xx alone does not fail it."}
          </p>
        </>
      )}

      {(node.type === "run-case" || node.type === "run-suite" || node.type === "run-request") && <RetryEditor retry={node.retry} onChange={(retry) => onChange({ ...node, retry })} />}

      {node.type === "if" && <ConditionEditor condition={node.condition} onChange={(condition) => onChange({ ...node, condition })} />}

      {node.type === "parallel" && (
        <p className="muted small">
          Wire two or more steps from "branches". They all start at once, each with its own copy of the flow variables. Wire the end of every branch into one Join to wait for them and carry on.
        </p>
      )}
      {node.type === "join" && (
        <p className="muted small">
          Waits until every branch of the Parallel before it has finished, then continues from "passed", or from "failed" if any branch failed. Variables set in the branches are merged; when two branches set the same one, the branch that finished last wins.
        </p>
      )}
      {node.type === "loop" && <LoopEditor node={node} onChange={onChange} />}

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
