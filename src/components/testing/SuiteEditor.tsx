import { useMemo, useRef, useState } from "react";
import { parseCsv } from "../../lib/csv";
import type { Vars } from "../../lib/template";
import { checkCounts, failureLine, latestCaseResult } from "../../lib/testing/caseStatus";
import { listPickableRequests } from "../../lib/testing/requestSources";
import { duplicateCase, newTestCase } from "../../lib/testing/suites";
import type { TestRun } from "../../lib/testing/testRun";
import type { CaseResult, RunMode, TestCase, TestSuite } from "../../lib/testing/types";
import { detectVarSets } from "../../lib/testing/varsDetect";
import { WithPlaceholders } from "../request/RequestEditor";
import { CheckIcon, CopyIcon, CrossIcon, PlayFilledIcon, SlidersIcon, TrashIcon } from "../shell/Icons";
import { OverflowMenu } from "../shell/OverflowMenu";
import { useToast } from "../shell/Toast";
import { reinsert, removeById } from "../../lib/listUndo";
import { CaseEditor } from "./CaseEditor";
import { RequestPicker } from "./RequestPicker";

const MODE_LABELS: Record<RunMode, string> = {
  sequential: "Sequential",
  "parallel-iterations": "Iterations in parallel",
  "parallel-cases": "Cases in parallel",
};

interface Props {
  suite: TestSuite;
  onChange: (suite: TestSuite) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  openCaseId: string | null;
  onOpenCase: (id: string | null) => void;
  onOpenSettings: () => void;
  running: boolean;
  /** True while any suite is running (only one runs at a time). */
  anyRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  onTryCase: (tc: TestCase) => void;
  tryingCaseId: string | null;
  tryResults: Record<string, CaseResult>;
  latestRun: TestRun | null;
  envVars: Vars;
  envName?: string;
  notice: string | null;
}

/** A case's path for the collapsed card: the URL without its {{baseUrl}} or host. */
function shortPath(url: string): string {
  const path = url.replace(/^\s*\{\{[^{}]+\}\}/, "").replace(/^https?:\/\/[^/]+/i, "");
  return path || url;
}

type Disc = "passed" | "failed" | "skipped" | "running" | "none";

/** The suite as a runbook: a header with run controls, then every case as a step on a timeline. */
export function SuiteEditor(props: Props) {
  const { suite, onChange, openCaseId, onOpenCase } = props;
  const [picking, setPicking] = useState(false);
  const toast = useToast();
  const propsRef = useRef(props);
  propsRef.current = props;
  const enabledCount = suite.cases.filter((c) => c.enabled).length;
  const rows = useMemo(() => (suite.data ? parseCsv(suite.data.text).rows.length : 0), [suite.data]);
  // Re-read saved requests when a different case opens, to pick up edits made in Requests mode.
  const sources = useMemo(() => listPickableRequests(), [openCaseId]);

  const setCases = (cases: TestCase[]) => onChange({ ...suite, cases });
  const updateCase = (tc: TestCase) => setCases(suite.cases.map((c) => (c.id === tc.id ? tc : c)));
  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= suite.cases.length) return;
    const cases = [...suite.cases];
    const [item] = cases.splice(index, 1);
    cases.splice(to, 0, item);
    setCases(cases);
  };
  const addCases = (list: TestCase[]) => {
    if (!list.length) return;
    setCases([...suite.cases, ...list]);
    onOpenCase(list[0].id);
  };

  const summary = [
    `${suite.cases.length} case${suite.cases.length === 1 ? "" : "s"} (${enabledCount} on)`,
    MODE_LABELS[suite.options.mode],
    suite.data ? `${suite.data.name}, ${rows} row${rows === 1 ? "" : "s"}` : "no CSV",
    suite.options.repeat > 1 ? `repeat ${suite.options.repeat}×` : null,
    `${suite.options.scriptTimeoutMs / 1000} s script limit`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="suite-doc" aria-label="Suite">
      <div className="suite-head">
        <div className="suite-title">
          <input className="suite-name" value={suite.name} onChange={(e) => onChange({ ...suite, name: e.target.value })} aria-label="Suite name" />
          <span className="muted small">{summary}</span>
          <input
            className="suite-description"
            value={suite.description}
            onChange={(e) => onChange({ ...suite, description: e.target.value })}
            placeholder="Add a description"
            aria-label="Suite description"
          />
        </div>
        <span className="flex-gap" />
        {props.notice && (
          <span className="small notice" role="status">
            {props.notice}
          </span>
        )}
        <button className="secondary icon-label" onClick={props.onOpenSettings}>
          <SlidersIcon />
          Run settings &amp; data
        </button>
        <OverflowMenu
          label="Suite actions"
          items={[
            { label: "Duplicate suite", icon: <CopyIcon />, onSelect: props.onDuplicate },
            { label: "Delete suite", icon: <TrashIcon />, onSelect: props.onDelete, danger: true, disabled: props.running, title: props.running ? "Stop the run first" : undefined, separated: true },
          ]}
        />
        {props.running ? (
          <button className="send cancel icon-label" onClick={props.onStop}>
            Stop
          </button>
        ) : (
          <button
            className="send icon-label"
            onClick={props.onRun}
            disabled={enabledCount === 0 || props.anyRunning}
            title={props.anyRunning ? "Another suite is running" : enabledCount === 0 ? "Add or enable a test case first" : "Run every enabled case"}
          >
            <PlayFilledIcon />
            Run suite
          </button>
        )}
      </div>

      <div className="suite-steps">
        <div className="suite-steps-inner">
          {suite.cases.length === 0 && <p className="muted pad">No cases yet. Add saved requests, or start a blank case.</p>}
          {suite.cases.map((c, i) => {
            const latest = latestCaseResult(c.id, props.tryResults[c.id], props.latestRun);
            const disc: Disc = !c.enabled ? "skipped" : props.running ? "running" : latest ? (latest.passed ? "passed" : "failed") : "none";
            const open = openCaseId === c.id;
            const source = c.sourceRequestId ? sources.find((r) => r.id === c.sourceRequestId) : undefined;
            return (
              <section key={c.id} className="step" aria-label={`Case ${i + 1}: ${c.name}`}>
                <div className="step-rail">
                  <StatusDisc disc={disc} n={i + 1} />
                  <span className="step-line" />
                </div>
                <div className="step-body">
                  {open ? (
                    <CaseEditor
                      key={c.id}
                      testCase={c}
                      index={i}
                      count={suite.cases.length}
                      onChange={updateCase}
                      onMove={(by) => move(i, by)}
                      onDuplicate={() => {
                        const copy = duplicateCase(c);
                        const cases = [...suite.cases];
                        cases.splice(i + 1, 0, copy);
                        setCases(cases);
                        onOpenCase(copy.id);
                      }}
                      onDelete={() => {
                        const taken = removeById(suite.cases, c.id);
                        if (!taken) return;
                        setCases(taken.list);
                        onOpenCase(null);
                        toast.show({
                          message: `Deleted "${c.name}"`,
                          onUndo: () => {
                            const cur = propsRef.current.suite;
                            propsRef.current.onChange({ ...cur, cases: reinsert(cur.cases, taken.item, taken.index) });
                          },
                        });
                      }}
                      onCollapse={() => onOpenCase(null)}
                      onTry={() => props.onTryCase(c)}
                      trying={props.tryingCaseId === c.id}
                      tryResult={props.tryResults[c.id] ?? null}
                      latest={latest}
                      sourceName={source?.path.join(" › ")}
                      onRefreshFromSource={source ? () => updateCase({ ...c, request: { ...structuredClone(source.request), id: c.request.id } }) : undefined}
                      envVars={props.envVars}
                      envName={props.envName}
                    />
                  ) : (
                    <CaseSummary testCase={c} latest={latest} onOpen={() => onOpenCase(c.id)} onToggle={(enabled) => updateCase({ ...c, enabled })} />
                  )}
                </div>
              </section>
            );
          })}

          <div className="step add-step">
            <div className="step-rail">
              <span className="disc dashed" aria-hidden />
            </div>
            <div className="step-body add-buttons">
              <button className="dashed-btn" onClick={() => setPicking(true)}>
                + From saved request
              </button>
              <button className="dashed-btn" onClick={() => addCases([newTestCase()])}>
                + Blank case
              </button>
            </div>
          </div>
        </div>
      </div>
      {picking && (
        <RequestPicker
          onClose={() => setPicking(false)}
          onPick={(list) => {
            setPicking(false);
            addCases(list.map((r) => newTestCase(r.request)));
          }}
        />
      )}
    </main>
  );
}

function StatusDisc({ disc, n }: { disc: Disc; n: number }) {
  if (disc === "passed")
    return (
      <span className="disc passed" title="Passed">
        <CheckIcon />
        <span className="visually-hidden">Passed</span>
      </span>
    );
  if (disc === "failed")
    return (
      <span className="disc failed" title="Failed">
        <CrossIcon />
        <span className="visually-hidden">Failed</span>
      </span>
    );
  if (disc === "running")
    return (
      <span className="disc running" title="Running">
        <span className="spinner" aria-hidden />
        <span className="visually-hidden">Running</span>
      </span>
    );
  return (
    <span className={`disc ${disc === "skipped" ? "skipped" : "idle"}`} title={disc === "skipped" ? "Skipped" : "Not run yet"}>
      {n}
    </span>
  );
}

/** A closed case: one line with its checkbox, name, method, path, checks and the variables it sets. */
function CaseSummary({ testCase: c, latest, onOpen, onToggle }: { testCase: TestCase; latest: CaseResult | null; onOpen: () => void; onToggle: (enabled: boolean) => void }) {
  const counts = latest ? checkCounts(latest) : null;
  const sets = latest?.passed ? detectVarSets(c.postScript) : [];
  const failed = c.enabled && latest && !latest.passed;
  return (
    <div className={`case-card ${failed ? "failed" : ""} ${c.enabled ? "" : "skipped"}`}>
      <div className="case-card-head">
        <input type="checkbox" checked={c.enabled} onChange={(e) => onToggle(e.target.checked)} aria-label={`Include ${c.name}`} title="Include in runs" />
        <button className="case-open" onClick={onOpen} title={`Open ${c.name}`}>
          <span className="case-name">{c.name}</span>
          <span className={`method m-${c.request.method.toLowerCase()}`}>{c.request.method}</span>
          <span className="case-path mono">
            <WithPlaceholders text={shortPath(c.request.url)} />
          </span>
          <span className="flex-gap" />
          {!c.enabled ? (
            <span className="small muted">Skipped</span>
          ) : (
            <>
              {counts && counts.total > 0 && (
                <span className={`small ${latest?.passed ? "tone-ok" : "tone-bad"}`}>
                  {counts.passed}/{counts.total} checks
                </span>
              )}
              {sets.length > 0 && (
                <>
                  <span className="small muted">sets</span>
                  {sets.map((v) => (
                    <span key={v.name} className="var-chip mono">
                      {v.name}
                    </span>
                  ))}
                </>
              )}
            </>
          )}
        </button>
      </div>
      {failed && latest && <div className="case-failure mono">{failureLine(latest)}</div>}
    </div>
  );
}
