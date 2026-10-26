/**
 * A small JSON checker and formatter that also accepts {{placeholders}}
 * wherever a value or key can go, so a request body like
 *   {"id": {{id}}, "name": "{{name}}"}
 * can be checked and formatted before the placeholders are filled in.
 * It also accepts // line comments and block comments outside strings; they
 * are removed by stripJsonComments before a request is sent.
 */

export type TokenType = "string" | "number" | "literal" | "placeholder" | "punct";

export interface Token {
  type: TokenType;
  text: string;
  from: number;
  to: number;
}

export interface JsonProblem {
  message: string;
  from: number;
  to: number;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL = /true|false|null/y;
const PLACEHOLDER = /\{\{[^{}]*\}\}/y;
const SPACE = /[ \t\r\n]*/y;

class JsonError extends Error {
  constructor(
    message: string,
    public from: number,
    public to: number,
  ) {
    super(message);
  }
}

function match(re: RegExp, text: string, at: number): string | null {
  re.lastIndex = at;
  const m = re.exec(text);
  return m && m[0].length > 0 ? m[0] : null;
}

/** Index just past the comment starting at `at`, or null when there is no comment there. */
function commentEnd(text: string, at: number): number | null {
  if (text[at] !== "/") return null;
  if (text[at + 1] === "/") {
    const nl = text.indexOf("\n", at + 2);
    return nl === -1 ? text.length : nl;
  }
  if (text[at + 1] === "*") {
    const close = text.indexOf("*/", at + 2);
    if (close === -1) throw new JsonError("Comment is missing its closing */", at, text.length);
    return close + 2;
  }
  return null;
}

/** Removes // and block comments that sit outside strings. Line breaks are kept. Text with no comments comes back unchanged. */
export function stripJsonComments(text: string): string {
  if (!text.includes("/")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    let end: number | null = null;
    try {
      end = commentEnd(text, i);
    } catch {
      end = text.length;
    }
    if (end !== null) {
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Start and end offsets of each comment outside strings, for highlighting. */
export function findJsonComments(text: string): [number, number][] {
  const out: [number, number][] = [];
  if (!text.includes("/")) return out;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    let end: number | null = null;
    try {
      end = commentEnd(text, i);
    } catch {
      end = text.length;
    }
    if (end !== null) {
      out.push([i, end]);
      i = end;
    } else {
      i += 1;
    }
  }
  return out;
}

/** True when the text has a comment outside its strings. */
export function hasJsonComments(text: string): boolean {
  return stripJsonComments(text) !== text;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    for (;;) {
      SPACE.lastIndex = i;
      SPACE.exec(text);
      i = SPACE.lastIndex;
      const end = i < text.length ? commentEnd(text, i) : null;
      if (end === null) break;
      i = end;
    }
    if (i >= text.length) break;
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") j += 1;
        else if (text[j] === "\n") throw new JsonError("Line break inside a string", j, j + 1);
        j += 1;
      }
      if (j >= text.length) throw new JsonError("String is missing its closing quote", i, text.length);
      tokens.push({ type: "string", text: text.slice(i, j + 1), from: i, to: j + 1 });
      i = j + 1;
      continue;
    }
    if ("{}[],:".includes(ch)) {
      const ph = ch === "{" ? match(PLACEHOLDER, text, i) : null;
      if (ph) {
        tokens.push({ type: "placeholder", text: ph, from: i, to: i + ph.length });
        i += ph.length;
      } else {
        tokens.push({ type: "punct", text: ch, from: i, to: i + 1 });
        i += 1;
      }
      continue;
    }
    const num = match(NUMBER, text, i);
    if (num) {
      tokens.push({ type: "number", text: num, from: i, to: i + num.length });
      i += num.length;
      continue;
    }
    const lit = match(LITERAL, text, i);
    if (lit) {
      tokens.push({ type: "literal", text: lit, from: i, to: i + lit.length });
      i += lit.length;
      continue;
    }
    let j = i;
    while (j < text.length && !/[\s{}[\],:"]/.test(text[j])) j += 1;
    throw new JsonError(`Unexpected "${text.slice(i, Math.max(j, i + 1))}"`, i, Math.max(j, i + 1));
  }
  return tokens;
}

/** Checks the token list against JSON grammar (placeholders count as values and keys). */
function parse(tokens: Token[], textLength: number): void {
  let pos = 0;
  const peek = () => tokens[pos];
  const fail = (message: string): never => {
    const t = tokens[pos];
    throw t ? new JsonError(message, t.from, t.to) : new JsonError(message, Math.max(0, textLength - 1), textLength);
  };
  const expect = (p: string, message: string) => {
    const t = peek();
    if (!t || t.type !== "punct" || t.text !== p) fail(message);
    pos += 1;
  };

  const value = (): void => {
    const t = peek();
    if (!t) fail("Expected a value");
    if (t.type === "punct" && t.text === "{") return object();
    if (t.type === "punct" && t.text === "[") return array();
    if (t.type === "punct") fail(`Expected a value but found "${t.text}"`);
    pos += 1;
  };

  const object = (): void => {
    expect("{", "Expected {");
    if (peek()?.type === "punct" && peek()!.text === "}") {
      pos += 1;
      return;
    }
    for (;;) {
      const key = peek();
      if (!key || (key.type !== "string" && key.type !== "placeholder")) fail("Expected a property name in double quotes");
      pos += 1;
      expect(":", "Expected : after the property name");
      value();
      const t = peek();
      if (t?.type === "punct" && t.text === ",") {
        pos += 1;
        if (peek()?.type === "punct" && peek()!.text === "}") fail("Trailing comma before }");
        continue;
      }
      expect("}", "Expected , or } after a value");
      return;
    }
  };

  const array = (): void => {
    expect("[", "Expected [");
    if (peek()?.type === "punct" && peek()!.text === "]") {
      pos += 1;
      return;
    }
    for (;;) {
      value();
      const t = peek();
      if (t?.type === "punct" && t.text === ",") {
        pos += 1;
        if (peek()?.type === "punct" && peek()!.text === "]") fail("Trailing comma before ]");
        continue;
      }
      expect("]", "Expected , or ] after a value");
      return;
    }
  };

  value();
  if (pos < tokens.length) fail("Unexpected content after the end of the JSON");
}

/** Returns null when the text is valid JSON (placeholders allowed), otherwise what is wrong and where. Blank text is valid. */
export function findJsonProblem(text: string): JsonProblem | null {
  if (text.trim() === "") return null;
  try {
    parse(tokenize(text), text.length);
    return null;
  } catch (e) {
    if (e instanceof JsonError) return { message: e.message, from: e.from, to: e.to };
    throw e;
  }
}

/** Pretty-prints JSON with 2-space indents, keeping placeholders and string contents exactly. Returns null if the text is not valid or has comments. */
export function formatJson(text: string, indent = "  "): string | null {
  // Formatting would drop the comments, so a body with comments is left as written.
  if (text.trim() === "" || findJsonProblem(text) || hasJsonComments(text)) return null;
  const tokens = tokenize(text);
  let out = "";
  let depth = 0;
  const newline = () => "\n" + indent.repeat(depth);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t.type === "punct" && (t.text === "{" || t.text === "[")) {
      const close = t.text === "{" ? "}" : "]";
      if (next?.type === "punct" && next.text === close) {
        out += t.text + close;
        i += 1;
      } else {
        depth += 1;
        out += t.text + newline();
      }
    } else if (t.type === "punct" && (t.text === "}" || t.text === "]")) {
      depth -= 1;
      out += newline() + t.text;
    } else if (t.type === "punct" && t.text === ",") {
      out += "," + newline();
    } else if (t.type === "punct" && t.text === ":") {
      out += ": ";
    } else {
      out += t.text;
    }
  }
  return out;
}
