import { emptyRow } from "../lib/defaults";
import { revealKey, type DuplicateReport } from "../lib/envVars";
import type { KeyValue } from "../lib/types";
import { LockIcon } from "./shell/Icons";
import { RevealButton } from "./shell/RevealButton";
import { useSecretInputsDisabled } from "./shell/SecretStatusBanner";

interface Props {
  envId: string;
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  duplicates: DuplicateReport;
  /** `envId:rowId` keys of secret values that are showing. Not saved. */
  revealed: ReadonlySet<string>;
  onToggleReveal: (envId: string, rowId: string) => void;
}

/** The variables of one environment: Variable, Value, Secret and Show columns under a sticky header. */
export function EnvVarsTable({ envId, rows, onChange, duplicates, revealed, onToggleReveal }: Props) {
  const waiting = useSecretInputsDisabled();

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
  const focusName = (id: string) => document.querySelector<HTMLInputElement>(`[data-row-name="${id}"]`)?.focus();

  return (
    <div className="dlg-scroll">
      <table className="dlg-table envdlg-vars">
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Variable</th>
            <th>Value</th>
            <th className="col-secret">Secret</th>
            <th className="col-show">Show</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isTrailing = i === rows.length - 1 && row.key === "" && row.value === "";
            const firstRow = duplicates.firstRowOf.get(row.id);
            const msgId = `envdlg-dup-${row.id}`;
            const shown = revealed.has(revealKey(envId, row.id));
            return [
              <tr key={row.id} id={`envdlg-row-${row.id}`} className={row.enabled ? "" : "disabled"}>
                <td>
                  <div className="envdlg-name-cell">
                    {!isTrailing && <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.id, { enabled: e.target.checked })} aria-label={`Use ${row.key || "variable"}`} />}
                    <input
                      value={row.key}
                      placeholder="Variable"
                      data-row-name={row.id}
                      className={firstRow ? "envdlg-dup" : undefined}
                      aria-invalid={firstRow ? true : undefined}
                      aria-describedby={firstRow ? msgId : undefined}
                      aria-label={`Row ${i + 1} variable name`}
                      onChange={(e) => update(row.id, { key: e.target.value })}
                      spellCheck={false}
                    />
                  </div>
                </td>
                <td>
                  <input
                    value={row.value}
                    placeholder="Value"
                    data-row-value={row.id}
                    onChange={(e) => update(row.id, { value: e.target.value })}
                    spellCheck={false}
                    type={row.secret && !shown ? "password" : "text"}
                    disabled={row.secret && waiting}
                    title={row.secret && waiting ? "Loading secret values from the keychain" : undefined}
                    autoComplete={row.secret ? "new-password" : undefined}
                    aria-label={row.secret ? `${row.key || "Variable"} value (secret)` : `${row.key || "Variable"} value`}
                  />
                </td>
                <td className="col-secret">
                  {!isTrailing && (
                    <button
                      className={`icon-btn ${row.secret ? "on" : ""}`}
                      onClick={() => update(row.id, { secret: row.secret ? undefined : true })}
                      aria-pressed={!!row.secret}
                      aria-label={row.secret ? `${row.key || "Variable"}: secret on` : `Mark ${row.key || "variable"} as secret`}
                      title={row.secret ? "Secret: masked on screen and left out of exports. Click to turn off." : "Mark as secret (mask it on screen, leave it out of exports)"}
                    >
                      <LockIcon />
                    </button>
                  )}
                </td>
                <td className="col-show">
                  {!isTrailing && (
                    <div className="dlg-cell-actions">
                      {row.secret ? <RevealButton shown={shown} onToggle={() => onToggleReveal(envId, row.id)} subject={row.key || undefined} /> : <span className="envdlg-reveal-gap" />}
                      <button className="icon-btn" onClick={() => remove(row.id)} title="Remove row" aria-label={`Remove row ${i + 1}`}>
                        ×
                      </button>
                    </div>
                  )}
                </td>
              </tr>,
              firstRow ? (
                <tr key={`${row.id}-dup`} className="envdlg-dup-row">
                  <td colSpan={4} id={msgId} role="status">
                    Same name as row {firstRow}.{" "}
                    <button type="button" className="link-btn" onClick={() => focusName(row.id)}>
                      Rename
                    </button>
                    {" · "}
                    <button type="button" className="link-btn" onClick={() => remove(row.id)}>
                      Remove this row
                    </button>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
