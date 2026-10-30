import { findJsonProblem, formatJson } from "../lib/jsonFormat";
import type { BodyMode, KeyValue } from "../lib/types";
import { CodeEditor } from "./CodeEditor";
import { useVariables } from "./variables/VariablesContext";
import type { Vars } from "../lib/template";
import { KeyValueEditor } from "./KeyValueEditor";

interface Props {
  mode: BodyMode;
  body: string;
  formBody: KeyValue[];
  /** Highlights placeholders in form values. */
  placeholderVars?: Vars;
  methodAllowsBody: boolean;
  onModeChange: (mode: BodyMode) => void;
  onBodyChange: (body: string) => void;
  onFormChange: (rows: KeyValue[]) => void;
  /** Show the mode choice, JSON status and Format link. Off when a section header shows them instead. */
  toolbar?: boolean;
  /** Line numbers in the text and JSON editor. */
  lineNumbers?: boolean;
}

const MODES: [BodyMode, string][] = [
  ["none", "none"],
  ["json", "raw JSON"],
  ["text", "raw text"],
  ["urlencoded", "x-www-form-urlencoded"],
];

/** Converts a character offset into "line X, column Y" for the error message. */
function lineCol(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const col = offset - before.lastIndexOf("\n");
  return `line ${line}, column ${col}`;
}

export function BodyEditor({ mode, body, formBody, placeholderVars, methodAllowsBody, onModeChange, onBodyChange, onFormChange, toolbar = true, lineNumbers = false }: Props) {
  const variables = useVariables();
  const problem = mode === "json" ? findJsonProblem(body) : null;

  const format = () => {
    const formatted = formatJson(body);
    if (formatted !== null) onBodyChange(formatted);
  };

  return (
    <div className="body-editor">
      {toolbar && (
      <div className="body-modes">
        {MODES.map(([value, label]) => (
          <label key={value} className="radio">
            <input type="radio" name="body-mode" checked={mode === value} onChange={() => onModeChange(value)} />
            {label}
          </label>
        ))}
        {mode === "json" && (
          <>
            <span className={`json-status ${problem ? "bad" : body.trim() ? "ok" : ""}`}>
              {problem ? "Invalid JSON" : body.trim() ? "Valid JSON" : ""}
            </span>
            <button className="link-btn" onClick={format} disabled={problem !== null || body.trim() === ""} title="Format (Shift+Alt+F)">
              Format
            </button>
          </>
        )}
      </div>
      )}

      {!methodAllowsBody && mode !== "none" && (
        <p className="warning small">GET and HEAD requests are sent without a body.</p>
      )}

      {mode === "none" && <p className="muted small">This request does not have a body.</p>}

      {(mode === "json" || mode === "text") && (
        <>
          <div className="code-editor-frame">
            <CodeEditor
              value={body}
              onChange={onBodyChange}
              json={mode === "json"}
              lineNumbers={lineNumbers}
              variableHover={variables ? { show: variables.hoverShow, leave: variables.hoverLeave, open: variables.hoverOpen } : undefined}
              ariaLabel="Request body"
              placeholder={mode === "json" ? 'Paste or type JSON, e.g. {"name": "{{name}}"}' : ""}
            />
          </div>
          {problem && (
            <p className="warning small">
              JSON problem at {lineCol(body, problem.from)}: {problem.message}
            </p>
          )}
        </>
      )}

      {mode === "urlencoded" && <KeyValueEditor rows={formBody} onChange={onFormChange} placeholderVars={placeholderVars} />}
    </div>
  );
}
