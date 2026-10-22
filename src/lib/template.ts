export type Vars = Record<string, string>;

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Replaces {{name}} with vars[name]. Unknown names are left as they are. */
export function applyTemplate(input: string, vars: Vars): string {
  return input.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}

/** Lists the distinct placeholder names used in a string. */
export function findPlaceholders(input: string): string[] {
  const names = new Set<string>();
  for (const m of input.matchAll(PLACEHOLDER)) names.add(m[1]);
  return [...names];
}

/**
 * Like applyTemplate, but for JSON bodies: a placeholder inside a JSON string
 * ("name": "{{name}}") gets its value escaped, so quotes, backslashes and
 * newlines from the CSV keep the JSON valid. A placeholder outside a string
 * ("age": {{age}}) is inserted as written, so numbers, true/false and null work.
 */
export function applyJsonTemplate(input: string, vars: Vars): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "{" && input[i + 1] === "{") {
      const close = input.indexOf("}}", i + 2);
      const name = close === -1 ? "" : input.slice(i + 2, close).trim();
      if (close !== -1 && name !== "" && !/[{}]/.test(name)) {
        if (Object.prototype.hasOwnProperty.call(vars, name)) {
          const value = vars[name];
          out += inString ? JSON.stringify(value).slice(1, -1) : value;
        } else {
          out += input.slice(i, close + 2);
        }
        i = close + 2;
        continue;
      }
    }
    if (inString && ch === "\\") {
      out += ch + (input[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') inString = !inString;
    out += ch;
    i += 1;
  }
  return out;
}
