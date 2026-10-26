import type { CaseResult } from "./types";
import type { TestRun } from "./testRun";

export interface GridCell {
  /** Index into the run's results, to open the result. */
  resultIndex: number;
  passed: boolean;
  /** The status code, "ERR" when no response came back, "—" when the case was not sent. */
  label: string;
}

export interface GridRow {
  iteration: number;
  /** 0-based CSV row, or null without data. */
  rowIndex: number | null;
  /** A short identifier for the row from its data: the first column's value. */
  title: string;
  /** One entry per column; null when that case has no result in this iteration (the run stopped first). */
  cells: (GridCell | null)[];
  failed: boolean;
}

export interface Grid {
  columns: { caseId: string; caseName: string; caseIndex: number }[];
  rows: GridRow[];
}

function cellLabel(r: CaseResult): string {
  if (!r.outcome) return "—";
  return r.outcome.ok ? String(r.outcome.response.status) : "ERR";
}

/** CSV rows × cases, as the explorer's grid shows them. Rows with a failed case come first when `failuresFirst`. */
export function buildGrid(run: Pick<TestRun, "results">, failuresFirst = true): Grid {
  const columns = new Map<string, Grid["columns"][number]>();
  for (const r of run.results) if (!columns.has(r.caseId)) columns.set(r.caseId, { caseId: r.caseId, caseName: r.caseName, caseIndex: r.caseIndex });
  const cols = [...columns.values()].sort((a, b) => a.caseIndex - b.caseIndex);

  const byIteration = new Map<number, GridRow>();
  run.results.forEach((r, resultIndex) => {
    let row = byIteration.get(r.iteration);
    if (!row) {
      const first = Object.values(r.vars)[0];
      row = { iteration: r.iteration, rowIndex: r.rowIndex, title: r.rowIndex !== null ? `Row ${r.rowIndex + 1}${first ? ` · ${first}` : ""}` : `Iteration ${r.iteration + 1}`, cells: cols.map(() => null), failed: false };
      byIteration.set(r.iteration, row);
    }
    row.cells[cols.findIndex((c) => c.caseId === r.caseId)] = { resultIndex, passed: r.passed, label: cellLabel(r) };
    if (!r.passed) row.failed = true;
  });
  const rows = [...byIteration.values()].sort((a, b) => a.iteration - b.iteration);
  return { columns: cols, rows: failuresFirst ? [...rows.filter((r) => r.failed), ...rows.filter((r) => !r.failed)] : rows };
}
