import { buildMatrix, revealKey } from "../lib/envVars";
import { ENV_COLOR_VARS, type Environment } from "../lib/environments";
import { AlertIcon } from "./shell/Icons";
import { RevealButton } from "./shell/RevealButton";
import { useSecretInputsDisabled } from "./shell/SecretStatusBanner";

interface Props {
  environments: Environment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (envId: string, rowId: string, value: string) => void;
  onAdd: (envId: string, name: string) => void;
  revealed: ReadonlySet<string>;
  onToggleReveal: (envId: string, rowId: string) => void;
}

/** Variables (rows) by environment (columns). Scrolls inside its own box, header and first column stay put. */
export function EnvCompare({ environments, selectedId, onSelect, onEdit, onAdd, revealed, onToggleReveal }: Props) {
  const waiting = useSecretInputsDisabled();
  const matrix = buildMatrix(environments);

  if (matrix.rows.length === 0) return <p className="muted">No variables yet. Add some in “This environment”.</p>;

  return (
    <div className="dlg-scroll envdlg-matrix-scroll">
      <table className="dlg-table envdlg-matrix" style={{ minWidth: `${150 + environments.length * 170}px` }}>
        <thead>
          <tr>
            <th className="envdlg-matrix-name">Variable</th>
            {environments.map((env) => {
              const color = env.color && env.color !== "none" ? ENV_COLOR_VARS[env.color] : undefined;
              return (
                <th key={env.id} className={env.id === selectedId ? "sel" : ""}>
                  <button type="button" className="dlg-th-btn" onClick={() => onSelect(env.id)} aria-pressed={env.id === selectedId} title={`Select ${env.name || "(unnamed)"}`}>
                    <span className={`dlg-dot${color ? "" : " none"}`} style={color ? { background: color } : undefined} aria-hidden />
                    <span className="dlg-item-name">{env.name || "(unnamed)"}</span>
                    {env.isProduction === true && <span className="env-prod-badge">PROD</span>}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.name}>
              <td className="envdlg-matrix-name" title={row.name}>
                <span className="dlg-static mono">{row.name}</span>
              </td>
              {row.cells.map((cell, i) => {
                const env = environments[i];
                const sel = env.id === selectedId ? "sel" : "";
                if (!cell.row) {
                  return (
                    <td key={env.id} className={sel}>
                      <div className="envdlg-missing">
                        <span className="envdlg-missing-label">
                          <AlertIcon size={13} />
                          Missing
                        </span>
                        <button type="button" className="envdlg-add" onClick={() => onAdd(env.id, row.name)} aria-label={`Add ${row.name} to ${env.name || "(unnamed)"}`}>
                          + Add
                        </button>
                      </div>
                    </td>
                  );
                }
                const shown = revealed.has(revealKey(env.id, cell.row.id));
                const secret = cell.row.secret === true;
                return (
                  <td key={env.id} className={sel}>
                    <div className="envdlg-cell">
                      <input
                        value={cell.row.value}
                        type={secret && !shown ? "password" : "text"}
                        disabled={secret && waiting}
                        autoComplete={secret ? "new-password" : undefined}
                        spellCheck={false}
                        aria-label={`${row.name} in ${env.name || "(unnamed)"}${secret ? " (secret)" : ""}`}
                        onChange={(e) => onEdit(env.id, cell.row!.id, e.target.value)}
                      />
                      {secret && <RevealButton shown={shown} onToggle={() => onToggleReveal(env.id, cell.row!.id)} subject={`${row.name} in ${env.name || "(unnamed)"}`} />}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
