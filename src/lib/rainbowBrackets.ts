/**
 * Rainbow brackets: finds the ( ) [ ] { } in a piece of code and says how deeply each is nested,
 * so every code view can colour matching pairs alike. Brackets inside strings and comments are
 * left alone, and so are the braces of {{placeholders}}. A bracket with no partner is an error.
 *
 * The on/off setting lives here too (saved through storage.ts, with a small subscribe API so every
 * code view follows the Settings switch without a reload).
 */
import { isBoolean, load, save } from "./storage";

/** Which rules decide what is a string or a comment. "plain" treats every bracket as a bracket (curl commands, form bodies). */
export type BracketLanguage = "json" | "js" | "python" | "shell" | "plain";

export interface BracketToken {
  /** Offset of the bracket character in the text. */
  index: number;
  /** Nesting depth of the pair, from 0. A closing bracket has the depth of its opening one. */
  depth: number;
  open: boolean;
  /** No partner (or the wrong kind of partner). */
  error: boolean;
}

/** How many colours the palette cycles through (--rb-0 ... --rb-3). */
export const RAINBOW_COLORS = 4;

/** Above this many characters colouring is skipped, so a huge response never slows typing or scrolling. */
export const MAX_RAINBOW_CHARS = 200_000;

interface Rules {
  quotes: string;
  /** Strings that may run over several lines. */
  multiline: string;
  triple: boolean;
  slashComments: boolean;
  hashComments: boolean;
  /** Single quotes in shell have no escapes. */
  rawSingle: boolean;
}

const RULES: Record<BracketLanguage, Rules> = {
  json: { quotes: '"', multiline: "", triple: false, slashComments: true, hashComments: false, rawSingle: false },
  js: { quotes: "\"'`", multiline: "`", triple: false, slashComments: true, hashComments: false, rawSingle: false },
  python: { quotes: "\"'", multiline: "", triple: true, slashComments: false, hashComments: true, rawSingle: false },
  shell: { quotes: "\"'", multiline: "", triple: false, slashComments: false, hashComments: true, rawSingle: true },
  plain: { quotes: "", multiline: "", triple: false, slashComments: false, hashComments: false, rawSingle: false },
};

const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const PLACEHOLDER = /\{\{[^{}]+\}\}/y;

/** Index just past the string that starts at `i`. */
function stringEnd(text: string, i: number, r: Rules): number {
  const q = text[i];
  if (r.triple && text.startsWith(q + q + q, i)) {
    const close = text.indexOf(q + q + q, i + 3);
    return close === -1 ? text.length : close + 3;
  }
  const multi = r.multiline.includes(q);
  const raw = r.rawSingle && q === "'";
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === q) return j + 1;
    // An unfinished string ends at the line break, so one stray quote does not swallow the rest while typing.
    if (c === "\n" && !multi && !raw) return j;
    j += c === "\\" && !raw ? 2 : 1;
  }
  return text.length;
}

/** Every bracket outside strings, comments and placeholders, with its depth. Empty when the text is over MAX_RAINBOW_CHARS. */
export function findBrackets(text: string, language: BracketLanguage = "json"): BracketToken[] {
  if (text.length > MAX_RAINBOW_CHARS) return [];
  const r = RULES[language];
  const out: BracketToken[] = [];
  const stack: number[] = []; // indexes into `out` of the open brackets
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "{" && text[i + 1] === "{") {
      PLACEHOLDER.lastIndex = i;
      const m = PLACEHOLDER.exec(text);
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    if (r.quotes.includes(c)) {
      i = stringEnd(text, i, r);
      continue;
    }
    if (r.slashComments && c === "/") {
      if (text[i + 1] === "/") {
        const nl = text.indexOf("\n", i + 2);
        i = nl === -1 ? text.length : nl;
        continue;
      }
      if (text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2);
        i = close === -1 ? text.length : close + 2;
        continue;
      }
    }
    if (r.hashComments && c === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      const nl = text.indexOf("\n", i + 1);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      stack.push(out.length);
      out.push({ index: i, depth: stack.length - 1, open: true, error: false });
    } else if (c === ")" || c === "]" || c === "}") {
      const top = stack.length ? out[stack[stack.length - 1]] : undefined;
      if (top && text[top.index] === PAIRS[c]) {
        stack.pop();
        out.push({ index: i, depth: top.depth, open: false, error: false });
      } else {
        out.push({ index: i, depth: 0, open: false, error: true });
      }
    }
    i++;
  }
  for (const k of stack) out[k].error = true;
  return out;
}

/** The CSS class that colours a bracket: rb-0 ... rb-3 by depth, or rb-err. */
export function bracketClass(t: BracketToken): string {
  return t.error ? "rb-err" : `rb-${t.depth % RAINBOW_COLORS}`;
}

export interface TextSegment {
  text: string;
  /** Set on a single bracket character; plain text between brackets has none. */
  className?: string;
}

/** Splits text into plain runs and coloured brackets, for views that render spans (the read-only <pre> views). */
export function bracketSegments(text: string, language: BracketLanguage = "json"): TextSegment[] {
  const tokens = findBrackets(text, language);
  if (tokens.length === 0) return [{ text }];
  const out: TextSegment[] = [];
  let at = 0;
  for (const t of tokens) {
    if (t.index > at) out.push({ text: text.slice(at, t.index) });
    out.push({ text: text[t.index], className: bracketClass(t) });
    at = t.index + 1;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** A guess for text that could be JSON or not: JSON rules when it starts with { or [, otherwise every bracket counts. */
export function guessLanguage(text: string): BracketLanguage {
  const c = text.trimStart()[0];
  return c === "{" || c === "[" ? "json" : "plain";
}

// ---- the setting ----

export const RAINBOW_KEY = "rest-runner.rainbow-brackets";

const listeners = new Set<() => void>();
let cached: boolean | null = null;

/** On unless switched off in Settings. */
export function getRainbowBrackets(): boolean {
  if (cached === null) cached = load<boolean>(RAINBOW_KEY, true, isBoolean);
  return cached;
}

export function setRainbowBrackets(on: boolean): void {
  cached = on;
  save(RAINBOW_KEY, on);
  for (const fn of [...listeners]) fn();
}

/** Calls `fn` whenever the setting changes. Returns the function that stops it. */
export function subscribeRainbowBrackets(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** For tests: forget the remembered value so the next read goes to storage. */
export function resetRainbowBracketsCache(): void {
  cached = null;
}
