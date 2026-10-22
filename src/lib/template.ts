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
