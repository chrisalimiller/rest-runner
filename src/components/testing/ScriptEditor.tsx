import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { nextDiagnostic, openLintPanel } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { useMemo, useRef, useState } from "react";
import { convertPostmanScript, findPostmanCalls } from "../../lib/postmanScripts";
import { RR_COMPLETIONS, SNIPPETS } from "../../lib/testing/snippets";
import { CodeEditor, type CodeIssue } from "../CodeEditor";

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

/** Underlines Postman pm.* calls and offers the rr.* replacement where there is one. */
function postmanIssues(code: string): CodeIssue[] {
  return findPostmanCalls(code).map((c) => ({
    from: c.from,
    to: c.to,
    message: `Postman ${c.api}: ${c.message}`,
    replacement: c.fix?.insert,
  }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
  const editor = useRef<EditorView | null>(null);
  const [converted, setConverted] = useState<{ count: number; result: string } | null>(null);
  const calls = useMemo(() => findPostmanCalls(value), [value]);
  const fixable = calls.filter((c) => c.fix).length;
  const manual = calls.length - fixable;
  const justConverted = converted && converted.result === value ? converted.count : 0;
  const convertAll = () => {
    const out = convertPostmanScript(value);
    setConverted({ count: out.converted, result: out.code });
    onChange(out.code);
  };
  const showFirst = () => {
    const view = editor.current;
    if (!view) return;
    view.dispatch({ selection: { anchor: 0 } });
    nextDiagnostic(view);
    openLintPanel(view);
  };
  const insert = (code: string) => onChange(value.trim() === "" ? `${code}\n` : `${value.replace(/\s*$/, "")}\n\n${code}\n`);

  return (
    <div className="script-editor">
      <div className="script-main">
        <p className="muted small">{HELP[context][phase]}</p>
        {calls.length > 0 && (
          <div className="postman-strip" role="status">
            <span>
              <b>Postman script.</b>{" "}
              {justConverted > 0
                ? `Converted ${plural(justConverted, "call", "calls")}. ${manual === 1 ? "1 still needs a change by hand." : `${manual} still need changes by hand.`}`
                : `${plural(calls.length, "pm.* call", "pm.* calls")}: ${fixable} can be converted, ${manual} ${manual === 1 ? "needs a change" : "need changes"} by hand.`}{" "}
              It will not run until these are converted.
            </span>
            {fixable > 0 && (
              <button className="link-btn" onClick={convertAll}>
                Convert all
              </button>
            )}
            <button className="link-btn" onClick={showFirst}>
              Show first
            </button>
          </div>
        )}
        <div className="code-editor-frame">
          <CodeEditor
            value={value}
            onChange={onChange}
            javascript
            completions={completions}
            findIssues={postmanIssues}
            onView={(v) => (editor.current = v)}
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
