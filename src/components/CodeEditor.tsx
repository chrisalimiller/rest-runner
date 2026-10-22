import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionSource } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder as placeholderExt,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { findJsonProblem, formatJson } from "../lib/jsonFormat";

/** GitHub dark syntax colors. */
const githubDarkHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: "#7ee787" },
  { tag: t.string, color: "#a5d6ff" },
  { tag: [t.number, t.bool, t.null], color: "#79c0ff" },
  { tag: [t.brace, t.squareBracket, t.separator, t.punctuation], color: "#e6edf3" },
  { tag: t.invalid, color: "#f85149" },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: "#ff7b72" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#d2a8ff" },
  { tag: [t.lineComment, t.blockComment], color: "#8b949e", fontStyle: "italic" },
  { tag: t.regexp, color: "#7ee787" },
]);

const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--bg-inset)", color: "var(--text)", fontSize: "12.5px" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55", overflow: "auto" },
    ".cm-content": { padding: "8px 0", caretColor: "var(--accent-fg)" },
    ".cm-line": { padding: "0 12px" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--accent-fg)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(56, 139, 253, 0.3) !important" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-matchingBracket": { backgroundColor: "rgba(63, 185, 80, 0.25)", outline: "1px solid rgba(63, 185, 80, 0.6)" },
    ".cm-placeholder": { color: "var(--muted)" },
    ".cm-tooltip": { backgroundColor: "var(--bg-overlay)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "6px" },
    ".cm-diagnostic-error": { borderLeft: "3px solid var(--danger)" },
    ".cm-lintRange-error": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--danger)",
      textUnderlineOffset: "3px",
    },
  },
  { dark: true },
);

/** Highlights {{placeholders}} so they stand out from JSON values. */
const placeholderMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    matcher = new MatchDecorator({ regexp: /\{\{[^{}]*\}\}/g, decoration: Decoration.mark({ class: "cm-template-var" }) });
    constructor(view: EditorView) {
      this.decorations = this.matcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = this.matcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

const jsonLinter = linter(
  (view) => {
    const text = view.state.doc.toString();
    const problem = findJsonProblem(text);
    if (!problem) return [];
    const from = Math.min(problem.from, text.length);
    const to = Math.min(Math.max(problem.to, from + 1), text.length);
    const d: Diagnostic = { from, to: Math.max(to, from), severity: "error", message: problem.message };
    return [d];
  },
  { delay: 250 },
);

/** When pasting, if the whole body becomes valid JSON, format it. One undo step reverts the formatting and the paste together. */
const formatOnPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const pasted = event.clipboardData?.getData("text/plain");
    if (!pasted) return false;
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc.toString();
    const next = doc.slice(0, from) + pasted + doc.slice(to);
    const formatted = formatJson(next);
    if (formatted === null) return false;
    event.preventDefault();
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: formatted },
      selection: { anchor: formatted.length },
      userEvent: "input.paste",
      scrollIntoView: true,
    });
    return true;
  },
});

/** Formats the whole document as JSON when it is valid. */
export function formatEditorJson(view: EditorView): boolean {
  const formatted = formatJson(view.state.doc.toString());
  if (formatted === null) return false;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
  return true;
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  /** JSON mode adds highlighting, error marks, and format on paste. */
  json?: boolean;
  /** JavaScript mode adds highlighting, plus the given autocomplete source when there is one. */
  javascript?: boolean;
  completions?: CompletionSource;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

// Mod-Enter is left to the app (Send), so the editor does not also insert a line.
const editorKeys = defaultKeymap.filter((k) => k.key !== "Mod-Enter");

export function CodeEditor({
  value,
  onChange,
  json: isJson = false,
  javascript: isJs = false,
  completions,
  readOnly = false,
  placeholder,
  ariaLabel,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const modeCompartment = useRef(new Compartment());

  const modeExtensions = (): Extension[] => {
    if (isJs) {
      return [
        javascript(),
        syntaxHighlighting(githubDarkHighlight),
        completions && !readOnly ? autocompletion({ override: [completions] }) : [],
      ];
    }
    return isJson ? [json(), syntaxHighlighting(githubDarkHighlight), readOnly ? [] : [jsonLinter, formatOnPaste]] : [];
  };

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      editorTheme,
      EditorView.lineWrapping,
      placeholderMarks,
      modeCompartment.current.of(modeExtensions()),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel ?? "Code", spellcheck: "false" }),
    ];
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    } else {
      extensions.push(
        bracketMatching(),
        history(),
        closeBrackets(),
        keymap.of([
          ...(isJs ? [] : [{ key: "Shift-Alt-f", run: formatEditorJson }]),
          ...closeBracketsKeymap,
          ...editorKeys,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
      );
    }
    if (placeholder) extensions.push(placeholderExt(placeholder));
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // The editor is created once; value, mode and handlers are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Keep the editor in step when the value changes from outside (loading a saved request, Format button, new response).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: modeCompartment.current.reconfigure(modeExtensions()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJson, isJs]);

  return <div ref={host} className={`code-editor ${readOnly ? "readonly" : ""}`} />;
}
