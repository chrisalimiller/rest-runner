import { useMemo, useState } from "react";
import type { CsvData } from "../lib/csv";
import { dropdownOptions, filterRows, hasFilters, NO_FILTERS, rangeIndices, type LastRunFilter, type RowFilters, type RowStatus } from "../lib/rowSelection";

interface Props {
  csv: CsvData;
  /** 0-based indices of the rows that will run. */
  selected: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  /** What the last saved run did with each row. Rows missing from it have not been run. */
  statuses: ReadonlyMap<number, RowStatus>;
  /** Whether there is a saved run to compare with, so the last-run column and shortcuts make sense. */
  hasHistory: boolean;
  disabled?: boolean;
}

const STATUS_TEXT: Record<RowStatus | "none", string> = { passed: "Passed", failed: "Failed", none: "Not run" };

/** The CSV as a table with a checkbox per row, column filters and shortcuts, to choose which rows a bulk run sends. */
export function RowPicker({ csv, selected, onChange, statuses, hasHistory, disabled }: Props) {
  const [filters, setFilters] = useState<RowFilters>(NO_FILTERS);
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState(String(csv.rows.length));

  const dropdowns = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of csv.headers) {
      const opts = dropdownOptions(csv.rows, h);
      if (opts) map.set(h, opts);
    }
    return map;
  }, [csv]);
  const exact = useMemo(() => new Set(dropdowns.keys()), [dropdowns]);

  const visible = useMemo(() => filterRows(csv.rows, filters, exact, statuses), [csv.rows, filters, exact, statuses]);
  const visibleSelected = visible.filter((i) => selected.has(i)).length;
  const allVisible = visible.length > 0 && visibleSelected === visible.length;
  const hiddenSelected = selected.size - visibleSelected;
  const total = csv.rows.length;

  const setColumn = (h: string, v: string) => setFilters((f) => ({ ...f, columns: { ...f.columns, [h]: v } }));
  const toggle = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    onChange(next);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    for (const i of visible) {
      if (allVisible) next.delete(i);
      else next.add(i);
    }
    onChange(next);
  };
  const pick = (indices: number[]) => onChange(new Set(indices));
  const notRun = csv.rows.map((_, i) => i).filter((i) => !statuses.has(i));
  const failedRows = csv.rows.map((_, i) => i).filter((i) => statuses.get(i) === "failed");
  const passedCount = [...statuses.values()].filter((s) => s === "passed").length;

  return (
    <div className="row-picker">
      {hasHistory && (
        <div className="row-picker-tools">
          <span className="muted">
            Last run: {passedCount} passed, {failedRows.length} failed, {notRun.length} not run
          </span>
          <button className="secondary" disabled={disabled || notRun.length === 0} onClick={() => pick(notRun)}>
            Select rows not yet run
          </button>
          <button className="secondary" disabled={disabled || failedRows.length === 0} onClick={() => pick(failedRows)}>
            Select failed rows
          </button>
        </div>
      )}

      <div className="row-picker-tools">
        <span className="muted">Select by row number</span>
        <label>
          From
          <input type="number" min={1} max={total} value={from} disabled={disabled} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          to
          <input type="number" min={1} max={total} value={to} disabled={disabled} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="secondary" disabled={disabled || rangeIndices(from, to, total).length === 0} onClick={() => pick(rangeIndices(from, to, total))}>
          Select range
        </button>
        <span className="row-picker-spacer" />
        <button className="secondary" disabled={disabled || selected.size === 0} onClick={() => onChange(new Set())}>
          Clear selection
        </button>
      </div>

      <div className="row-picker-scroll">
        <table className="results row-picker-table">
          <thead>
            <tr>
              <th className="rp-check">
                <input type="checkbox" aria-label="Select all visible rows" checked={allVisible} ref={(el) => { if (el) el.indeterminate = visibleSelected > 0 && !allVisible; }} disabled={disabled || visible.length === 0} onChange={toggleAll} />
              </th>
              <th className="rp-num">#</th>
              {csv.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
              {hasHistory && <th className="rp-last">last run</th>}
            </tr>
            <tr className="rp-filters">
              <th className="rp-check" />
              <th className="rp-num" />
              {csv.headers.map((h) => {
                const opts = dropdowns.get(h);
                return (
                  <th key={h}>
                    {opts ? (
                      <select aria-label={`Filter ${h}`} value={filters.columns[h] ?? ""} onChange={(e) => setColumn(h, e.target.value)}>
                        <option value="">All</option>
                        {opts.map((o) => (
                          <option key={o} value={o}>
                            {o === "" ? "(empty)" : o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input type="text" aria-label={`Filter ${h}`} placeholder="Contains…" value={filters.columns[h] ?? ""} onChange={(e) => setColumn(h, e.target.value)} />
                    )}
                  </th>
                );
              })}
              {hasHistory && (
                <th className="rp-last">
                  <select aria-label="Filter last run" value={filters.last} onChange={(e) => setFilters((f) => ({ ...f, last: e.target.value as LastRunFilter }))}>
                    <option value="">All</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                    <option value="none">Not run</option>
                  </select>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((i) => {
              const status = statuses.get(i) ?? "none";
              const on = selected.has(i);
              return (
                <tr key={i} className={on ? "rp-on" : ""} onClick={() => !disabled && toggle(i)}>
                  <td className="rp-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select row ${i + 1}`} checked={on} disabled={disabled} onChange={() => toggle(i)} />
                  </td>
                  <td className="rp-num">{i + 1}</td>
                  {csv.headers.map((h) => (
                    <td key={h}>{csv.rows[i][h]}</td>
                  ))}
                  {hasHistory && <td className={`rp-last status-${status}`}>{STATUS_TEXT[status]}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="muted small rp-empty">
            No rows match these filters.{" "}
            <button className="link-btn" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </button>
          </p>
        )}
      </div>

      <div className="row-picker-tools">
        <span>
          <strong>{selected.size}</strong> of {total} rows selected
        </span>
        <span className="muted">
          Showing {visible.length} of {total}
        </span>
        {hiddenSelected > 0 && <span className="warning">{hiddenSelected} selected {hiddenSelected === 1 ? "row is" : "rows are"} hidden by filters and will still run</span>}
        {hasFilters(filters) && (
          <button className="link-btn" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
