/** Finds the run variables a script sets with rr.vars.set("name", value), without running it. */

export interface VarSet {
  name: string;
  /** The value expression as written, e.g. rr.response.json().id */
  expression: string;
}

/** Blanks out comments so commented-out calls are not found. Strings are kept as they are. */
function stripComments(code: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < code.length) {
    const ch = code[i];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += code[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Reads from `start` up to the ")" that closes the call, skipping nested brackets and strings. */
function readArgument(code: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return ch === ")" ? code.slice(start, i).trim() : null;
      depth -= 1;
    }
  }
  return null;
}

const CALL = /\brr\s*\.\s*vars\s*\.\s*set\s*\(\s*(["'`])((?:(?!\1)[^\\\n]|\\.)+)\1\s*,/g;

/** Each distinct variable name set with a literal name, with the expression from its first call. */
export function detectVarSets(script: string): VarSet[] {
  const code = stripComments(script);
  const seen = new Map<string, VarSet>();
  for (const m of code.matchAll(CALL)) {
    const name = m[2];
    if (m[1] === "`" && name.includes("${")) continue;
    if (seen.has(name)) continue;
    const expression = readArgument(code, (m.index ?? 0) + m[0].length);
    if (expression === null) continue;
    seen.set(name, { name, expression: expression.replace(/\s+/g, " ") });
  }
  return [...seen.values()];
}
