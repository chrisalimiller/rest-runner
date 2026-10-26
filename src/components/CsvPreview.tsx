import type { CsvData } from "../lib/csv";

/** The first rows of a loaded CSV as a grid, with a count of the rest. */
export function CsvPreview({ csv, rows = 5 }: { csv: CsvData; rows?: number }) {
  if (csv.rows.length === 0) return null;
  return (
    <div className="csv-preview">
      <table className="results">
        <thead>
          <tr>
            <th>#</th>
            {csv.headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csv.rows.slice(0, rows).map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {csv.headers.map((h) => (
                <td key={h}>{r[h]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {csv.rows.length > rows && <p className="muted small">…and {csv.rows.length - rows} more rows</p>}
    </div>
  );
}
