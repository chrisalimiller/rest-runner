import { emptyRow } from "../lib/defaults";
import type { KeyValue } from "../lib/types";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/** Postman-style table of key/value rows. A blank row is always kept at the end. */
export function KeyValueEditor({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value" }: Props) {
  const update = (id: string, patch: Partial<KeyValue>) => {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    const last = next[next.length - 1];
    if (!last || last.key !== "" || last.value !== "") next.push(emptyRow());
    onChange(next);
  };

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    onChange(next.length ? next : [emptyRow()]);
  };

  return (
    <table className="kv">
      <thead>
        <tr>
          <th className="kv-check" />
          <th>{keyPlaceholder}</th>
          <th>{valuePlaceholder}</th>
          <th className="kv-del" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const isTrailing = i === rows.length - 1 && row.key === "" && row.value === "";
          return (
            <tr key={row.id} className={row.enabled ? "" : "disabled"}>
              <td className="kv-check">
                {!isTrailing && (
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => update(row.id, { enabled: e.target.checked })}
                    aria-label="Enabled"
                  />
                )}
              </td>
              <td>
                <input
                  value={row.key}
                  placeholder={keyPlaceholder}
                  onChange={(e) => update(row.id, { key: e.target.value })}
                  spellCheck={false}
                />
              </td>
              <td>
                <input
                  value={row.value}
                  placeholder={valuePlaceholder}
                  onChange={(e) => update(row.id, { value: e.target.value })}
                  spellCheck={false}
                />
              </td>
              <td className="kv-del">
                {!isTrailing && (
                  <button className="icon-btn" onClick={() => remove(row.id)} title="Remove row" aria-label="Remove row">
                    ×
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function countActive(rows: KeyValue[]): number {
  return rows.filter((r) => r.enabled && r.key.trim() !== "").length;
}
