import { useEffect, useMemo, useState } from "react";
import { requestSummaryLine } from "../../lib/requestSummary";
import type { Vars } from "../../lib/template";
import { assertionResults, failureLine } from "../../lib/testing/caseStatus";
import { detectVarSets } from "../../lib/testing/varsDetect";
import { caseRuns } from "../../lib/testing/plan";
import { NO_RETRY, type CaseResult, type CaseRuns, type TestCase } from "../../lib/testing/types";
import type { RequestDef } from "../../lib/types";
import type { FlowUse } from "../../lib/flows/usedBy";
import { RequestEditor, WithPlaceholders } from "../request/RequestEditor";
import { ArrowDownIcon, CopyIcon, PlayFilledIcon, TrashIcon } from "../shell/Icons";
import { Modal } from "../shell/Modal";
import { OverflowMenu } from "../shell/OverflowMenu";
import { AssertionEditor } from "./AssertionEditor";
import { CaseResultView } from "./CaseResultView";
import { RetryEditor } from "./RetryEditor";
import { ScriptEditor } from "./ScriptEditor";

type Tab = "assertions" | "pre" | "post";

interface Props {
  testCase: TestCase;
  /** Position among the cases that run at the same time (setup, the normal list or teardown), and how many there are. */
  index: number;
  count: number;
  /** The first case shown in the runbook: nothing runs before it, so "Try up to here" is off. */
  first: boolean;
  onChange: (tc: TestCase) => void;
  onMove: (by: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCollapse: () => void;
  /** Sends this one case (with its scripts and assertions) using the first CSV row, if any. */
  onTry: () => void;
  /** Runs the cases from the first through this one, once. */
  onTryUpTo: () => void;
  trying: boolean;
  tryResult: CaseResult | null;
  /** The latest result: the Try case result, or from the latest run. */
  latest: CaseResult | null;
  /** Name of the saved request this case was copied from, when it still exists. */
  sourceName?: string;
  onRefreshFromSource?: () => void;
  /** The saved request has changed since this case copied it. */
  sourceChanged?: boolean;
  /** Flows with a Run case step for this case. */
  usedBy?: FlowUse[];
  onOpenFlow?: (flowId: string, nodeId: string) => void;
  envVars: Vars;
  envName?: string;
  /** A run is in progress: the case can be read but not changed until it ends. */
  locked?: boolean;
}

/** The open case in the runbook: header actions, request summary, checks and scripts, and what the post-script passes on. */
export function CaseEditor(props: Props) {
  const { testCase: tc, onChange, latest } = props;
  const [tab, setTab] = useState<Tab>("assertions");
  const [editing, setEditing] = useState(false);
  const def = tc.request;
  const patchReq = (p: Partial<RequestDef>) => onChange({ ...tc, request: { ...def, ...p } });
  const activeAssertions = tc.assertions.filter((a) => a.enabled).length;
  const [results, setResults] = useState<Map<string, import("../../lib/testing/caseStatus").AssertionResult>>(new Map());
  useEffect(() => {
    const controller = new AbortController();
    setResults(new Map());
    void assertionResults(tc.assertions, latest, controller.signal).then((next) => {
      if (!controller.signal.aborted) setResults(next);
    });
    return () => controller.abort();
  }, [tc.assertions, latest]);
  const refreshFromSource = () => {
    if (window.confirm(`Replace this case's request with the current version of "${props.sourceName}"? Scripts and assertions are kept.`)) props.onRefreshFromSource?.();
  };
  const varSets = useMemo(() => detectVarSets(tc.postScript), [tc.postScript]);
  const lastVars = latest?.postScript?.vars;

  return (
    <div className={`case-card open ${latest && !latest.passed ? "failed" : ""} ${props.locked ? "locked" : ""}`} inert={props.locked}>
      <div className="case-card-head">
        <input type="checkbox" checked={tc.enabled} onChange={(e) => onChange({ ...tc, enabled: e.target.checked })} aria-label={`Include ${tc.name}`} title="Include in runs" />
        <input className="case-name-input" value={tc.name} onChange={(e) => onChange({ ...tc, name: e.target.value })} aria-label="Test case name" />
        {props.sourceName && (
          <span className="muted small case-source" title={`Copied from ${props.sourceName}. This case has its own copy; changes here do not change the saved request.`}>
            from saved request
          </span>
        )}
        {props.sourceName && props.sourceChanged && props.onRefreshFromSource && (
          <button className="link-btn small case-source" onClick={refreshFromSource} title={`"${props.sourceName}" has changed since this case copied it. Click to update the case from it; scripts and assertions are kept.`}>
            changed since copied
          </button>
        )}
        <span className="flex-gap" />
        <div className="case-actions-group">
          <OverflowMenu
            label="Case actions"
            items={[
              { label: "Move up", icon: "↑", onSelect: () => props.onMove(-1), disabled: props.index === 0 },
              { label: "Move down", icon: "↓", onSelect: () => props.onMove(1), disabled: props.index === props.count - 1 },
              { label: "Duplicate", icon: <CopyIcon />, onSelect: props.onDuplicate },
              ...(props.onRefreshFromSource
                ? [
                    {
                      label: "Update from saved request",
                      icon: "↻",
                      title: `Replace this case's request with the current version of "${props.sourceName}". Scripts and assertions are kept.`,
                      onSelect: refreshFromSource,
                    },
                  ]
                : []),
              ...(props.usedBy ?? []).map((u, i) => ({
                label: `Open flow “${u.flowName}”`,
                icon: "→",
                title: "This case is a Run case step in that flow",
                separated: i === 0,
                onSelect: () => props.onOpenFlow?.(u.flowId, u.nodeId),
              })),
              { label: "Delete case", icon: <TrashIcon />, onSelect: props.onDelete, danger: true, separated: true },
            ]}
          />
          <span className="split-btn">
            <button className="secondary try-btn" onClick={props.onTry} disabled={props.trying || def.url.trim() === ""} title="Send this case once, with its scripts and assertions">
              <PlayFilledIcon size={10} />
              {props.trying ? "Running…" : "Try case"}
            </button>
            <OverflowMenu
              label="More ways to try"
              triggerTitle="More ways to try"
              triggerClass="secondary split-caret"
              trigger={<span aria-hidden>▾</span>}
              disabled={props.trying || props.first}
              items={[
                { label: "Try up to here", onSelect: props.onTryUpTo, title: "Run the enabled cases before this one, then this one, so variables they set are available" },
              ]}
            />
          </span>
          <button className="square-btn" onClick={props.onCollapse} aria-label="Collapse case" title="Collapse">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>

      {latest && !latest.passed && <div className="case-failure mono">{failureLine(latest)}</div>}

      <div className="case-card-body">
        <div className="case-request">
          <span className={`method m-${def.method.toLowerCase()}`}>{def.method}</span>
          <span className="case-request-url mono" title={def.url}>
            {def.url ? <WithPlaceholders text={def.url} /> : <span className="muted">No URL yet</span>}
          </span>
          <span className="muted small">{requestSummaryLine(def)}</span>
          <button className="link-btn small" onClick={() => setEditing(true)}>
            Edit request
          </button>
        </div>

        <label className="case-runs small">
          <span>Runs</span>
          <select
            value={caseRuns(tc)}
            onChange={(e) => {
              const runs = e.target.value as CaseRuns;
              const { runs: _old, ...rest } = tc;
              onChange(runs === "each" ? rest : { ...rest, runs });
            }}
            aria-label="When this case runs"
          >
            <option value="each">For every row</option>
            <option value="before">Once, before the rows (setup)</option>
            <option value="after">Once, after the rows (teardown)</option>
          </select>
          {caseRuns(tc) === "before" && <span className="muted">Runs one time. Variables it sets (like a token) are passed to every row. If it fails, the rows are not run.</span>}
          {caseRuns(tc) === "after" && <span className="muted">Runs one time, after the last row, even if rows failed. It starts from the variables setup set.</span>}
        </label>

        <div className="case-tabs" role="tablist" aria-label="Case parts">
          <button role="tab" aria-selected={tab === "assertions"} className={tab === "assertions" ? "active" : ""} onClick={() => setTab("assertions")}>
            Assertions {activeAssertions || ""}
          </button>
          <button role="tab" aria-selected={tab === "pre"} className={tab === "pre" ? "active" : ""} onClick={() => setTab("pre")}>
            Pre-request{tc.preScript.trim() ? " •" : ""}
          </button>
          <button role="tab" aria-selected={tab === "post"} className={tab === "post" ? "active" : ""} onClick={() => setTab("post")}>
            Post-response{tc.postScript.trim() ? " •" : ""}
          </button>
        </div>

        <div className="case-tab-panel">
          {tab === "assertions" && <AssertionEditor assertions={tc.assertions} onChange={(assertions) => onChange({ ...tc, assertions })} results={results} />}
          {tab === "pre" && <ScriptEditor phase="pre" value={tc.preScript} onChange={(preScript) => onChange({ ...tc, preScript })} />}
          {tab === "post" && <ScriptEditor phase="post" value={tc.postScript} onChange={(postScript) => onChange({ ...tc, postScript })} />}
        </div>

        <RetryEditor
          what="case"
          retry={tc.retry ?? NO_RETRY}
          onChange={(retry) => {
            const { retry: _old, ...rest } = tc;
            onChange(retry.times > 0 ? { ...rest, retry } : rest);
          }}
        />

        {varSets.length > 0 && (
          <div className="passes-on">
            {varSets.map((v) => (
              <div key={v.name} className="passes-on-row">
                <ArrowDownIcon />
                <span>Passes on</span>
                <span className="var-chip mono">{v.name}</span>
                <span className="mono passes-on-expr" title={v.expression}>
                  rr.vars.set("{v.name}", {v.expression})
                </span>
                <span className="flex-gap" />
                {lastVars && lastVars[v.name] !== undefined && (
                  <span className="passes-on-last" title={lastVars[v.name]}>
                    last: <span className="mono">{lastVars[v.name]}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {props.tryResult ? (
          <details className="case-try">
            <summary>
              Last try: {props.tryResult.passed ? "passed" : "failed"} · {props.tryResult.checks.filter((c) => c.passed).length}/{props.tryResult.checks.length} checks
            </summary>
            <CaseResultView key={props.tryResult.startedAt} result={props.tryResult} title="Last try" />
          </details>
        ) : (
          <p className="muted small">
            <b>Try case</b> sends this case once and fills in Last result. Variables set by earlier cases are not available when trying one case on its own.
          </p>
        )}
      </div>

      {editing && (
        <Modal label={`Edit request of ${tc.name}`} onClose={() => setEditing(false)} className="request-modal">
          <div className="modal-head">
            <h3>Edit request · {tc.name}</h3>
            <button className="icon-btn" onClick={() => setEditing(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="request-col in-modal">
            <RequestEditor
              def={def}
              onChange={patchReq}
              envVars={props.envVars}
              envName={props.envName}
              detailsKey="rest-runner.case-request-details"
              urlPlaceholder="Enter URL, e.g. {{baseUrl}}/users/{{id}}"
              scriptsNote="In a test run, the request's scripts run first, then this case's own Pre-request and Post-response scripts."
            />
            <div className="action-footer">
              <button className="send" onClick={() => setEditing(false)}>
                Done
              </button>
              <span className="muted small">Changes apply to this case only.</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
