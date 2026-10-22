/**
 * Reads a value with a simple JSON path: $.data.items[0].id, items[0].name,
 * $["key with spaces"], or $.items.length. Returns undefined when any step is missing.
 */
export function parsePath(path: string): (string | number)[] {
  let p = path.trim();
  if (p.startsWith("$")) p = p.slice(1);
  const steps: (string | number)[] = [];
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === ".") {
      i += 1;
      continue;
    }
    if (ch === "[") {
      const close = p.indexOf("]", i);
      if (close === -1) throw new Error(`Missing ] in path "${path}"`);
      const inner = p.slice(i + 1, close).trim();
      const quoted = /^(["'])(.*)\1$/.exec(inner);
      if (quoted) steps.push(quoted[2]);
      else if (/^-?\d+$/.test(inner)) steps.push(Number(inner));
      else if (inner === "*") throw new Error("Wildcards are not supported in paths");
      else steps.push(inner);
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < p.length && p[j] !== "." && p[j] !== "[") j += 1;
    steps.push(p.slice(i, j));
    i = j;
  }
  return steps;
}

export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const step of parsePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (typeof step === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[step < 0 ? current.length + step : step];
    } else if (step === "length" && (Array.isArray(current) || typeof current === "string")) {
      current = current.length;
    } else if (typeof current === "object" && Object.prototype.hasOwnProperty.call(current, step)) {
      current = (current as Record<string, unknown>)[step];
    } else {
      return undefined;
    }
  }
  return current;
}
