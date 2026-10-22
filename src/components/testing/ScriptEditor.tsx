import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { useMemo } from "react";
import { RR_COMPLETIONS, SNIPPETS } from "../../lib/testing/snippets";
import { CodeEditor } from "../CodeEditor";

interface Props {
  phase: "pre" | "post";
  value: string;
  onChange: (value: string) => void;
  /** Where the script lives; changes the help line. */
  context?: "case" | "request";
}

function rrCompletions(phase: "pre" | "post") {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/rr(\.[\w]*)*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return {
      from: word.from,
      options: RR_COMPLETIONS.filter((c) => !c.phase || c.phase === phase).map((c) => ({ label: c.label, detail: c.detail, type: "function" })),
      validFor: /^rr(\.[\w]*)*$/,
    };
  };
}

const HELP = {
  case: {
    pre: "Runs before the request is sent. Set variables with rr.vars.set(); the request then uses them as {{name}}.",
    post: "Runs after the response arrives. Add checks with rr.test() and pass values to later cases with rr.vars.set().",
  },
  request: {
    pre: "Runs before every send, and before each row of a CSV run. Set variables with rr.vars.set(); the request then uses them as {{name}}.",
    post: "Runs after the response arrives. Add checks with rr.test(); a failing check fails the send. Values saved with rr.vars.set() are used by later sends.",
  },
};

export function ScriptEditor({ phase, value, onChange, context = "case" }: Props) {
  const completions = useMemo(() => rrCompletions(phase), [phase]);
  const snippets = SNIPPETS.filter((s) => s.phase === phase || s.phase === "both");
  const insert = (code: string) => onChange(value.trim() === "" ? `${code}\n` : `${value.replace(/\s*$/, "")}\n\n${code}\n`);

  return (
    <div className="script-editor">
      <div className="script-main">
        <p className="muted small">{HELP[context][phase]}</p>
        <div className="code-editor-frame">
          <CodeEditor
            value={value}
            onChange={onChange}
            javascript
            completions={completions}
            ariaLabel={phase === "pre" ? "Pre-request script" : "Post-response script"}
            placeholder={phase === "pre" ? '// e.g. rr.vars.set("id", rr.data.id)' : '// e.g. rr.test("ok", () => rr.expect(rr.response.status).toBe(200))'}
          />
        </div>
      </div>
      <div className="script-snippets">
        <div className="sidebar-title">
          <span>Snippets</span>
        </div>
        {snippets.map((s) => (
          <button key={s.label} className="link-btn" onClick={() => insert(s.code)} title={s.code}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
