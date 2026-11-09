import { useEffect, useMemo, useState } from "react";
import { statusClass } from "../lib/format";
import { currentMasker } from "../lib/secrets";
import type { Run, RunEntry, RunSummary } from "../lib/run";
import { getRun, listRuns } from "../lib/runStore";
import {
  compareChoices,
  compareRuns,
  diffJson,
  filterChanges,
  isTruncated,
  type CompareFilter,
  type Delta,
  type RowChange,
} from "../lib/runCompare";
import { CallDetail } from "./CallDetail";
import "./runCompare.css";

const PAGE_SIZE = 500;

interface Props {
  /** The run open in the explorer. Differences are shown from the chosen run to this one. */
  run: Run;
  onClose: () => void;
}

function runLabel(r: RunSummary): string {
  return `${new Date(r.startedAt).toLocaleString()} · ${r.csvName} · ${r.passed} passed, ${r.failed} failed`;
}

function statusCell(label: string, entry: RunEntry | null) {
  if (!entry) return <span className="muted">none</span>;
  const cls = label === "Error" ? "bad" : statusClass(Number(label));
  return <span className={`status ${cls}`}>{label}</span>;
}

function DeltaValue({ d, unit = "", lowerIsBetter }: { d: Delta; unit?: string; lowerIsBetter?: boolean }) {
  const sign = d.delta > 0 ? "+" : d.delta < 0 ? "-" : "";
  const worse = lowerIsBetter === undefined || d.delta === 0 ? null : lowerIsBetter ? d.delta > 0 : d.delta < 0;
  return (
    <>
      <b>
        {d.current}
        {unit}
      </b>
      <span className={`delta ${worse === null ? "" : worse ? "bad" : "ok"}`}>
        {d.delta === 0 ? "no change" : `${sign}${Math.abs(d.delta)}${unit}`} <span className="muted">(was {d.base}{unit})</span>
      </span>
    </>
  );
}

function BodyDiff({ change }: { change: RowChange }) {
  const mask = currentMasker();
  const b = change.base?.outcome;
  const c = change.current?.outcome;
  if (!b?.ok || !c?.ok) return null;
  if (isTruncated(change.base!) || isTruncated(change.current!)) {
    return <p className="small muted">A saved response was cut short, so the body difference is not shown.</p>;
  }
  const d = diffJson(mask(b.response.body), mask(c.response.body));
  if (!d.ok) {
    return <p className="small muted">{d.reason} Compare the bodies in the Response tabs below.</p>;
  }
  if (d.changes.length === 0) return <p className="small muted">The JSON bodies have the same fields and values.</p>;
  return (
    <div className="body-diff">
      <table className="kv readonly" aria-label="Changed JSON fields">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {d.changes.map((x) => (
            <tr key={x.path}>
              <td className="mono">{x.path}</td>
              <td className={`mono ${x.kind === "added" ? "muted" : ""}`}>{x.kind === "added" ? "absent" : x.before}</td>
              <td className={`mono ${x.kind === "removed" ? "muted" : ""}`}>{x.kind === "removed" ? "absent" : x.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.capped && <p className="small muted">Showing the first {d.changes.length} changed fields.</p>}
    </div>
  );
}

/** Compare the open saved run with another saved run of the same request. */
export function RunCompare({ run, onClose }: Props) {
  const [summaries, setSummaries] = useState<RunSummary[] | null>(null);
  const [baseId, setBaseId] = useState("");
  const [base, setBase] = useState<Run | null | undefined>(undefined);
  const [filter, setFilter] = useState<CompareFilter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    let live = true;
    listRuns()
      .then((all) => live && setSummaries(all))
      .catch(() => live && setSummaries([]));
    return () => {
      live = false;
    };
  }, []);

  const choices = useMemo(() => (summaries ? compareChoices(run, summaries) : []), [summaries, run]);

  // Default to the newest run of the same request that started before this one, else the newest candidate.
  useEffect(() => {
    if (baseId || choices.length === 0) return;
    const prior = choices.find((c) => c.sameRequest && c.run.startedAt < run.startedAt) ?? choices[0];
    setBaseId(prior.run.id);
  }, [choices, baseId, run.startedAt]);

  useEffect(() => {
    if (!baseId) {
      setBase(undefined);
      return;
    }
    let live = true;
    setBase(undefined);
    getRun(baseId)
      .then((r) => live && setBase(r ?? null))
      .catch(() => live && setBase(null));
    return () => {
      live = false;
    };
  }, [baseId]);

  // Computed only once both runs are loaded.
  const comparison = useMemo(() => (base ? compareRuns(base, run) : null), [base, run]);
  const shown = useMemo(() => (comparison ? filterChanges(comparison.changes, filter) : []), [comparison, filter]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
    setSelected(shown[0]?.index ?? null);
  }, [comparison, filter]);

  const visible = shown.slice(0, limit);
  const change = shown.find((c) => c.index === selected) ?? null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = visible.findIndex((v) => v.index === selected);
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) setSelected(next.index);
  };

  const sameChoices = choices.filter((c) => c.sameRequest);
  const csvChoices = choices.filter((c) => !c.sameRequest);
  const s = comparison?.summary;
  const counts = comparison?.counts;

  return (
    <section className="explorer run-compare" aria-label="Compare runs">
      <div className="explorer-head">
        <div>
          <button className="link-btn" onClick={onClose}>
            ← Back to run
          </button>
          <h2>Compare runs</h2>
          <p className="muted small">
            {run.requestName} · this run: {new Date(run.startedAt).toLocaleString()}
          </p>
        </div>
      </div>

      {summaries === null ? (
        <p className="muted">Loading saved runs…</p>
      ) : choices.length === 0 ? (
        <p className="muted" role="status">
          There is no other saved run of this request to compare with. Run the batch again, then come back here. Saved runs with the same CSV file name also
          qualify.
        </p>
      ) : (
        <div className="compare-pick">
          <label htmlFor="compare-base">Compare this run with</label>
          <select id="compare-base" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            {sameChoices.length > 0 && (
              <optgroup label="Same request">
                {sameChoices.map((c) => (
                  <option key={c.run.id} value={c.run.id}>
                    {runLabel(c.run)}
                  </option>
                ))}
              </optgroup>
            )}
            {csvChoices.length > 0 && (
              <optgroup label="Different request, same CSV file">
                {csvChoices.map((c) => (
                  <option key={c.run.id} value={c.run.id}>
                    {c.run.requestName} · {runLabel(c.run)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="muted small">Baseline is the chosen run. Regressions are rows that got worse in this run.</span>
        </div>
      )}

      {baseId && base === undefined && <p className="muted">Loading run…</p>}
      {base === null && <p className="muted">That run could not be loaded. It may have been removed.</p>}

      {comparison && s && counts && base && (
        <>
          {comparison.warnings.length > 0 && (
            <ul className="compare-warnings small" aria-label="Things to know about this comparison">
              {comparison.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <div className="stat-cards compare-stats" role="group" aria-label="Summary of differences">
            <div className="stat">
              <DeltaValue d={s.passed} lowerIsBetter={false} />
              <span>passed</span>
            </div>
            <div className="stat">
              <DeltaValue d={s.failed} lowerIsBetter />
              <span>failed</span>
            </div>
            <div className="stat">
              <DeltaValue d={s.avgMs} unit=" ms" lowerIsBetter />
              <span>average</span>
            </div>
            <div className="stat">
              <DeltaValue d={s.p50Ms} unit=" ms" lowerIsBetter />
              <span>median</span>
            </div>
            <div className="stat">
              <DeltaValue d={s.p95Ms} unit=" ms" lowerIsBetter />
              <span>95th percentile</span>
            </div>
          </div>

          {comparison.changes.length === 0 ? (
            <p className="compare-empty" role="status">
              <strong>No differences.</strong> All {comparison.compared} matched {comparison.compared === 1 ? "row has" : "rows have"} the same status class and similar
              timing.
            </p>
          ) : (
            <div className="explorer-body compare-body">
              <div className="results-list">
                <div className="results-toolbar" role="radiogroup" aria-label="Filter changes">
                  {(
                    [
                      ["all", `All changes (${comparison.changes.length})`],
                      ["regressions", `Regressions (${counts.regressions})`],
                      ["fixes", `Fixes (${counts.fixes})`],
                      ["slower", `Slower (${counts.slower})`],
                    ] as const
                  ).map(([f, label]) => (
                    <label key={f} className="radio">
                      <input type="radio" name="compare-filter" checked={filter === f} onChange={() => setFilter(f)} />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="results-scroll" tabIndex={0} onKeyDown={onKeyDown} aria-label="Changed rows. Use the up and down arrow keys to move between rows.">
                  <table className="results compare-table">
                    <caption className="sr-only">Rows that changed between the two runs</caption>
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Before</th>
                        <th scope="col">After</th>
                        <th scope="col">Time</th>
                        <th scope="col">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((c) => (
                        <tr
                          key={c.index}
                          className={selected === c.index ? "selected" : ""}
                          aria-selected={selected === c.index}
                          onClick={() => setSelected(c.index)}
                        >
                          <td>{c.index + 1}</td>
                          <td>{statusCell(c.baseStatus, c.base)}</td>
                          <td>{statusCell(c.currentStatus, c.current)}</td>
                          <td>
                            {c.baseMs === null || c.currentMs === null ? "" : `${c.baseMs} → ${c.currentMs} ms`}
                          </td>
                          <td>
                            <span className={`pill ${c.regression ? "bad" : c.fix ? "ok" : ""}`}>
                              {c.onlyIn === "base"
                                ? "Not in this run"
                                : c.onlyIn === "current"
                                  ? "New row"
                                  : c.regression
                                    ? "Regression"
                                    : c.fix
                                      ? "Fix"
                                      : c.slower
                                        ? "Slower"
                                        : c.faster
                                          ? "Faster"
                                          : "Status changed"}
                            </span>
                            {c.slower && (c.regression || c.fix) && <span className="pill">Slower</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {shown.length === 0 && <p className="muted small pad">No rows match this filter.</p>}
                  {shown.length > visible.length && (
                    <button className="link-btn show-more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                      Showing {visible.length} of {shown.length}. Show {Math.min(PAGE_SIZE, shown.length - visible.length)} more
                    </button>
                  )}
                </div>
                <p className="small muted">
                  {comparison.unchanged} of {comparison.compared} matched rows unchanged. Slower means at least 50% and 100 ms longer.
                </p>
              </div>
              <div className="result-detail compare-detail">
                {change ? (
                  <>
                    <h3 className="compare-detail-title">Row {change.index + 1}</h3>
                    <BodyDiff change={change} />
                    <div className="compare-sides">
                      <div aria-label="Baseline run">
                        <h4>Baseline</h4>
                        {change.base ? <CallDetail key={`b${change.index}`} entry={change.base} /> : <p className="muted small">This row was not sent in the baseline run.</p>}
                      </div>
                      <div aria-label="This run">
                        <h4>This run</h4>
                        {change.current ? <CallDetail key={`c${change.index}`} entry={change.current} /> : <p className="muted small">This row was not sent in this run.</p>}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="muted small">Select a row to see both calls side by side.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
