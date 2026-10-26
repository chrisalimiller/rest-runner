import { useState } from "react";
import { emptyRow } from "../lib/defaults";
import type { Vars } from "../lib/template";
import type { KeyValue } from "../lib/types";
import { PlaceholderInput } from "./PlaceholderInput";
import { EyeIcon, EyeOffIcon, LockIcon } from "./shell/Icons";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Adds a lock toggle per row; locked values show as dots with a reveal button (environment variables). */
  secrets?: boolean;
  /** Highlights {{placeholders}} in the value column: filled when this has a value for them, missing when not. */
  placeholderVars?: Vars;
}

/** Postman-style table of key/value rows. A blank row is always kept at the end. */
export function KeyValueEditor({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value", secrets = false, placeholderVars }: Props) {
  // Which secret rows are showing their value. Not saved.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const reveal = (id: string) =>
    setRevealed((r) => {
      const next = new Set(r);
      if (!next.delete(id)) next.add(id);
      return next;
    });
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
          {secrets && <th className="kv-secret" />}
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
                {placeholderVars && !row.secret ? (
                  <PlaceholderInput
                    value={row.value}
                    vars={placeholderVars}
                    placeholder={valuePlaceholder}
                    data-row-value={row.id}
                    onChange={(value) => update(row.id, { value })}
                    spellCheck={false}
                  />
                ) : (
                  <input
                    value={row.value}
                    placeholder={valuePlaceholder}
                    data-row-value={row.id}
                    onChange={(e) => update(row.id, { value: e.target.value })}
                    spellCheck={false}
                    type={row.secret && !revealed.has(row.id) ? "password" : "text"}
                    autoComplete={row.secret ? "new-password" : undefined}
                    aria-label={row.secret ? `${row.key || "Variable"} value (secret)` : undefined}
                  />
                )}
              </td>
              {secrets && (
                <td className="kv-secret">
                  {!isTrailing && (
                    <>
                      <button
                        className={`icon-btn ${row.secret ? "on" : ""}`}
                        onClick={() => update(row.id, { secret: row.secret ? undefined : true })}
                        aria-pressed={!!row.secret}
                        aria-label={row.secret ? "Secret: on" : "Mark as secret"}
                        title={row.secret ? "Secret: masked on screen and left out of exports. Click to turn off." : "Mark as secret (mask it on screen, leave it out of exports)"}
                      >
                        <LockIcon />
                      </button>
                      {row.secret && (
                        <button className="icon-btn" onClick={() => reveal(row.id)} aria-label={revealed.has(row.id) ? "Hide value" : "Show value"} title={revealed.has(row.id) ? "Hide value" : "Show value"}>
                          {revealed.has(row.id) ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      )}
                    </>
                  )}
                </td>
              )}
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
