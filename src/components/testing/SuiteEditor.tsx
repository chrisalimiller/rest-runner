import { guardStyle } from "../../lib/environments";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { parseCsv } from "../../lib/csv";
import type { Vars } from "../../lib/template";
import { checkCounts, failureLine, latestCaseResult } from "../../lib/testing/caseStatus";
import { listPickableRequests } from "../../lib/testing/requestSources";
import { caseTally, runningLabel, type CaseTally } from "../../lib/testing/progress";
import { duplicateCase, newTestCase } from "../../lib/testing/suites";
import type { TestRun } from "../../lib/testing/testRun";
import type { CaseResult, RunMode, TestCase, TestSuite } from "../../lib/testing/types";
import { detectVarSets } from "../../lib/testing/varsDetect";
import { WithPlaceholders } from "../request/RequestEditor";
import { CheckIcon, CopyIcon, ClockIcon, CrossIcon, PlayFilledIcon, SlidersIcon, TrashIcon } from "../shell/Icons";
import { OverflowMenu } from "../shell/OverflowMenu";
import { useToast } from "../shell/Toast";
import { reinsert, removeById } from "../../lib/listUndo";
import { dropIndex, moveItem, reorderAnnouncement } from "../../lib/reorder";
import { caseRuns, splitCases, type CaseSlot } from "../../lib/testing/plan";
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
  /** Opens (or makes) the flow that runs this suite on a schedule. */
  onSchedule: () => void;
  openCaseId: string | null;
  onOpenCase: (id: string | null) => void;
  onOpenSettings: () => void;
  running: boolean;
  /** Progress of the run in progress for this suite: the counts on each case's disc and the headline. */
  live?: { results: CaseResult[]; iterations: number; planned: number } | null;
  /** True while any suite is running (only one runs at a time). */
  anyRunning: boolean;
  onRun: () => void;
  onStop: () => void;
  onTryCase: (tc: TestCase) => void;
  onTryUpTo: (tc: TestCase) => void;
  tryingCaseId: string | null;
  tryResults: Record<string, CaseResult>;
  latestRun: TestRun | null;
  envVars: Vars;
  envName?: string;
  /** The selected environment has a colour: Run suite is outlined and says where it runs. */
  guard?: { color: "green" | "blue" | "amber" | "red"; cssColor: string; runSuite: string } | null;
  notice: string | null;
}

/** A case's path for the collapsed card: the URL without its {{baseUrl}} or host. */
function shortPath(url: string): string {
  const path = url.replace(/^\s*\{\{[^{}]+\}\}/, "").replace(/^https?:\/\/[^/]+/i, "");
  return path || url;
}

const GROUP_TITLES = { before: "Setup · runs once before the rows", each: "Every row", after: "Teardown · runs once after the rows" } as const;

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
  // The runbook shows setup cases first, the normal list, then teardown. Reordering stays inside one group;
  // the Runs control on a case moves it to another group.
  const groups = splitCases(suite.cases);
  const grouped = groups.before.length > 0 || groups.after.length > 0;
  const displayed = [...groups.before, ...groups.each, ...groups.after];
  /** The group (in display order) that holds a case. */
  const groupOf = (cases: TestCase[], id: string): CaseSlot[] => {
    const g = splitCases(cases);
    return [g.before, g.each, g.after].find((list) => list.some((s) => s.testCase.id === id)) ?? [];
  };
  const move = (id: string, by: number) => {
    const group = groupOf(suite.cases, id);
    const at = group.findIndex((s) => s.testCase.id === id);
    const to = group[at + by];
    if (at >= 0 && to) setCases(moveItem(suite.cases, group[at].caseIndex, to.caseIndex));
  };

  // Reordering by dragging a case's disc (pointer) or with Space and the arrow keys.
  const [lifted, setLifted] = useState<{ id: string; how: "pointer" | "keyboard"; original: TestCase[] } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const stepsRef = useRef<HTMLDivElement>(null);
  const liftedId = lifted?.id;
  const liftedHow = lifted?.how;
  /** Moves a case to a position (0-based) inside its own group. */
  const moveCaseTo = (id: string, to: number) => {
    const cur = propsRef.current.suite;
    const group = groupOf(cur.cases, id);
    const from = group.findIndex((s) => s.testCase.id === id);
    const target = group[Math.max(0, Math.min(group.length - 1, to))];
    if (from < 0 || !target) return;
    const next = moveItem(cur.cases, group[from].caseIndex, target.caseIndex);
    if (next !== cur.cases) propsRef.current.onChange({ ...cur, cases: next });
  };
  const say = (id: string, phase: Parameters<typeof reorderAnnouncement>[1]) => {
    const group = groupOf(propsRef.current.suite.cases, id);
    const i = group.findIndex((s) => s.testCase.id === id);
    if (i >= 0) setAnnouncement(reorderAnnouncement(group[i].testCase.name || `Case ${i + 1}`, phase, i + 1, group.length));
  };
  useEffect(() => {
    if (!liftedId || liftedHow !== "pointer") return;
    const onMove = (e: PointerEvent) => {
      const ids = new Set(groupOf(propsRef.current.suite.cases, liftedId).map((s) => s.testCase.id));
      const els = [...(stepsRef.current?.querySelectorAll<HTMLElement>("[data-case-id]") ?? [])].filter((el) => ids.has(el.dataset.caseId ?? ""));
      const middles = els.map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      const from = els.findIndex((el) => el.dataset.caseId === liftedId);
      if (from >= 0) moveCaseTo(liftedId, dropIndex(middles, from, e.clientY));
    };
    const onUp = () => {
      setLifted(null);
      say(liftedId, "drop");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.classList.add("dragging-case");
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("dragging-case");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liftedId, liftedHow]);

  const onHandleKey = (e: React.KeyboardEvent, c: TestCase) => {
    const cases = propsRef.current.suite.cases;
    const group = groupOf(cases, c.id);
    const i = group.findIndex((x) => x.testCase.id === c.id);
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (lifted?.id === c.id) {
        setLifted(null);
        say(c.id, "drop");
      } else {
        setLifted({ id: c.id, how: "keyboard", original: cases });
        say(c.id, "lift");
      }
    } else if (lifted?.id === c.id && lifted.how === "keyboard") {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        moveCaseTo(c.id, i + (e.key === "ArrowUp" ? -1 : 1));
        // Say it after the move has been applied.
        queueMicrotask(() => say(c.id, "move"));
      } else if (e.key === "Escape") {
        e.preventDefault();
        propsRef.current.onChange({ ...propsRef.current.suite, cases: lifted.original });
        setLifted(null);
        setAnnouncement(reorderAnnouncement(c.name || `Case ${i + 1}`, "cancel", i + 1, group.length));
      }
    }
  };
  const addCases = (list: TestCase[]) => {
    if (!list.length) return;
    setCases([...suite.cases, ...list]);
    onOpenCase(list[0].id);
  };

  const summary = [
    `${suite.cases.length} case${suite.cases.length === 1 ? "" : "s"} (${enabledCount} on)`,
    groups.before.length || groups.after.length ? [groups.before.length ? `${groups.before.length} setup` : "", groups.after.length ? `${groups.after.length} teardown` : ""].filter(Boolean).join(", ") : null,
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
          {props.running && props.live ? (
            <span className="small running-line" role="status">
              {runningLabel(props.live.results, props.live.iterations, props.live.planned)}
              <span className="muted"> · Edits apply to the next run</span>
            </span>
          ) : (
            <span className="muted small">{summary}</span>
          )}
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
            { label: "Schedule…", icon: <ClockIcon />, onSelect: props.onSchedule, title: "Run this suite at set times, from a flow in Flows" },
            { label: "Delete suite", icon: <TrashIcon />, onSelect: props.onDelete, danger: true, disabled: props.running, title: props.running ? "Stop the run first" : undefined, separated: true },
          ]}
        />
        {props.running ? (
          <button className="send cancel icon-label" onClick={props.onStop}>
            Stop
          </button>
        ) : (
          <button
            className={`send icon-label ${props.guard ? "guarded" : ""}`}
            style={guardStyle(props.guard) as React.CSSProperties | undefined}
            onClick={props.onRun}
            disabled={enabledCount === 0 || props.anyRunning}
            title={props.anyRunning ? "Another suite is running" : enabledCount === 0 ? "Add or enable a test case first" : "Run every enabled case"}
          >
            <PlayFilledIcon />
            {props.guard ? props.guard.runSuite : "Run suite"}
          </button>
        )}
      </div>

      <div className="suite-steps">
        <div className="suite-steps-inner" ref={stepsRef}>
          <div className="visually-hidden" aria-live="assertive" role="status">
            {announcement}
          </div>
          {suite.cases.length === 0 && <p className="muted pad">No cases yet. Add saved requests, or start a blank case.</p>}
          {displayed.map(({ testCase: c, caseIndex: i }, di) => {
            const phase = caseRuns(c);
            const group = groups[phase];
            const groupAt = group.findIndex((s) => s.testCase.id === c.id);
            const title = grouped && (di === 0 || caseRuns(displayed[di - 1].testCase) !== phase) ? GROUP_TITLES[phase] : null;
            const latest = latestCaseResult(c.id, props.tryResults[c.id], props.latestRun);
            const disc: Disc = !c.enabled ? "skipped" : props.running ? "running" : latest ? (latest.passed ? "passed" : "failed") : "none";
            const tally = disc === "running" && props.live ? caseTally(props.live.results, c.id) : undefined;
            const open = openCaseId === c.id;
            const source = c.sourceRequestId ? sources.find((r) => r.id === c.sourceRequestId) : undefined;
            return (
              <Fragment key={c.id}>
              {title && <h3 className="step-group-title section-title">{title}</h3>}
              <section className={`step ${lifted?.id === c.id ? "lifted" : ""}`} data-case-id={c.id} aria-label={`Case ${di + 1}: ${c.name}`}>
                <div className="step-rail">
                  <button
                    type="button"
                    className="step-handle"
                    aria-roledescription="draggable case"
                    aria-label={`Reorder case ${di + 1}: ${c.name}`}
                    title="Drag to reorder, or press Space, then the arrow keys"
                    aria-pressed={lifted?.id === c.id}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      e.currentTarget.focus();
                      setLifted({ id: c.id, how: "pointer", original: suite.cases });
                    }}
                    onKeyDown={(e) => onHandleKey(e, c)}
                    onBlur={() => lifted?.id === c.id && lifted.how === "keyboard" && setLifted(null)}
                  >
                    <StatusDisc disc={disc} n={di + 1} tally={tally} />
                  </button>
                  <span className="step-line" />
                </div>
                <div className="step-body">
                  {open ? (
                    <CaseEditor
                      key={c.id}
                      testCase={c}
                      index={groupAt}
                      count={group.length}
                      first={di === 0}
                      onChange={updateCase}
                      onMove={(by) => move(c.id, by)}
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
                      onTryUpTo={() => props.onTryUpTo(c)}
                      trying={props.tryingCaseId === c.id}
                      tryResult={props.tryResults[c.id] ?? null}
                      latest={latest}
                      sourceName={source?.path.join(" › ")}
                      onRefreshFromSource={source ? () => updateCase({ ...c, request: { ...structuredClone(source.request), id: c.request.id } }) : undefined}
                      envVars={props.envVars}
                      envName={props.envName}
                      locked={props.running}
                    />
                  ) : (
                    <CaseSummary testCase={c} latest={latest} locked={props.running} onOpen={() => onOpenCase(c.id)} onToggle={(enabled) => updateCase({ ...c, enabled })} />
                  )}
                </div>
              </section>
              </Fragment>
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

function StatusDisc({ disc, n, tally }: { disc: Disc; n: number; tally?: CaseTally }) {
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
  if (disc === "running") {
    const counted = tally && tally.passed + tally.failed > 0;
    return (
      <span className="disc running" title={counted ? `Running: ${tally.passed} passed, ${tally.failed} failed so far` : "Running"}>
        <span className="spinner" aria-hidden />
        <span className="visually-hidden">Running</span>
        {counted && (
          <span className="disc-tally" aria-hidden>
            <span className="tone-ok">✓{tally.passed}</span>
            {tally.failed > 0 && <span className="tone-bad">✕{tally.failed}</span>}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={`disc ${disc === "skipped" ? "skipped" : "idle"}`} title={disc === "skipped" ? "Skipped" : "Not run yet"}>
      {n}
    </span>
  );
}

/** A closed case: one line with its checkbox, name, method, path, checks and the variables it sets. */
function CaseSummary({ testCase: c, latest, locked, onOpen, onToggle }: { testCase: TestCase; latest: CaseResult | null; locked: boolean; onOpen: () => void; onToggle: (enabled: boolean) => void }) {
  const counts = latest ? checkCounts(latest) : null;
  const sets = latest?.passed ? detectVarSets(c.postScript) : [];
  const failed = c.enabled && latest && !latest.passed;
  return (
    <div className={`case-card ${failed ? "failed" : ""} ${c.enabled ? "" : "skipped"}`}>
      <div className="case-card-head">
        <input type="checkbox" checked={c.enabled} disabled={locked} onChange={(e) => onToggle(e.target.checked)} aria-label={`Include ${c.name}`} title={locked ? "Edits apply to the next run" : "Include in runs"} />
        <button className="case-open" onClick={onOpen} title={`Open ${c.name}`}>
          <span className="case-name">{c.name}</span>
          <span className={`method m-${c.request.method.toLowerCase()}`}>{c.request.method}</span>
          <span className="case-path mono">
            <WithPlaceholders text={shortPath(c.request.url)} />
          </span>
          <span className="flex-gap" />
          {c.runs === "before" || c.runs === "after" ? <span className="small muted">{c.runs === "before" ? "once before" : "once after"}</span> : null}
          {(c.retry?.times ?? 0) > 0 && <span className="small muted" title={`Tries again up to ${c.retry?.times} time${c.retry?.times === 1 ? "" : "s"} when it fails`}>↻ {c.retry?.times}</span>}
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
