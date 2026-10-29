import type { CurlNote } from "../../lib/curlImport";
import type { VarSwap } from "../../lib/curlVariables";
import "./curlImport.css";

interface Props {
  summary: string;
  swaps: VarSwap[];
  /** Name of the environment the variables came from. */
  envName: string;
  /** True while the request shows {{variables}}; false after "Keep literal values". */
  usingVars: boolean;
  notes: CurlNote[];
  onToggleVars: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}

/** Joins "a, b and c". */
function listNames(names: string[]): React.ReactNode[] {
  return names.flatMap((n, i) => [
    i === 0 ? null : i === names.length - 1 ? " and " : ", ",
    <code key={n} className="curl-var">{`{{${n}}}`}</code>,
  ]);
}

/** Under the URL row after a cURL command filled a request: what was done, what was left out, and Undo. */
export function CurlBanner({ summary, swaps, envName, usingVars, notes, onToggleVars, onUndo, onDismiss }: Props) {
  const names = [...new Set(swaps.map((s) => s.name))];
  const env = envName || "the selected environment";
  return (
    <div className="curl-banner" role="status">
      <div className="curl-banner-head">
        <strong>Filled from a cURL command</strong>
        <span className="muted curl-banner-summary">{summary}</span>
        <span className="curl-banner-gap" />
        <button className="link-btn" onClick={onUndo}>
          Undo
        </button>
        <button className="link-btn muted" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
          ✕
        </button>
      </div>
      <ul className="curl-banner-notes">
        {names.length > 0 && (
          <li>
            {usingVars ? (
              <>
                <span className="curl-mark ok">✓</span> Used {listNames(names)} from {env} where the values matched.{" "}
                <button className="link-btn" onClick={onToggleVars}>
                  Keep literal values
                </button>
              </>
            ) : (
              <>
                <span className="curl-mark muted">·</span> Kept the literal values.{" "}
                <button className="link-btn" onClick={onToggleVars}>
                  Use variables
                </button>
              </>
            )}
          </li>
        )}
        {notes.map((n, i) => (
          <li key={i}>
            <span className={`curl-mark ${n.level === "warn" ? "warn" : "muted"}`}>{n.level === "warn" ? "!" : "·"}</span> {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
