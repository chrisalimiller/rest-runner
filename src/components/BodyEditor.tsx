import { applyJsonTemplate, findPlaceholders } from "../lib/template";
import type { BodyMode, KeyValue } from "../lib/types";
import { KeyValueEditor } from "./KeyValueEditor";

interface Props {
  mode: BodyMode;
  body: string;
  formBody: KeyValue[];
  methodAllowsBody: boolean;
  onModeChange: (mode: BodyMode) => void;
  onBodyChange: (body: string) => void;
  onFormChange: (rows: KeyValue[]) => void;
}

const MODES: [BodyMode, string][] = [
  ["none", "none"],
  ["json", "raw JSON"],
  ["text", "raw text"],
  ["urlencoded", "x-www-form-urlencoded"],
];

function jsonError(body: string): string | null {
  if (body.trim() === "") return null;
  // Placeholders are not valid JSON until filled in, so fill each with 0 first
  // (valid both inside a string and as a bare value).
  const probe = applyJsonTemplate(body, Object.fromEntries(findPlaceholders(body).map((n) => [n, "0"])));
  try {
    JSON.parse(probe);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid JSON";
  }
}

export function BodyEditor({ mode, body, formBody, methodAllowsBody, onModeChange, onBodyChange, onFormChange }: Props) {
  const error = mode === "json" ? jsonError(body) : null;

  const format = () => {
    try {
      onBodyChange(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      // leave as is
    }
  };

  return (
    <div className="body-editor">
      <div className="body-modes">
        {MODES.map(([value, label]) => (
          <label key={value} className="radio">
            <input type="radio" name="body-mode" checked={mode === value} onChange={() => onModeChange(value)} />
            {label}
          </label>
        ))}
        {mode === "json" && (
          <button className="link-btn" onClick={format} disabled={error !== null}>
            Format
          </button>
        )}
      </div>

      {!methodAllowsBody && mode !== "none" && (
        <p className="warning small">GET and HEAD requests are sent without a body.</p>
      )}

      {mode === "none" && <p className="muted">This request does not have a body.</p>}

      {(mode === "json" || mode === "text") && (
        <>
          <textarea
            className="code"
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            spellCheck={false}
            placeholder={mode === "json" ? '{\n  "name": "{{name}}"\n}' : ""}
          />
          {error && <p className="warning small">JSON problem: {error}</p>}
        </>
      )}

      {mode === "urlencoded" && <KeyValueEditor rows={formBody} onChange={onFormChange} />}
    </div>
  );
}
