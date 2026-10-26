import { ENVIRONMENTS_KEY, type Environment } from "./environments";
import { load } from "./storage";

export const SECRET_MASK = "••••••";

/** Every way a value can appear in text we show or export: as is, JSON-escaped, URL-encoded, HTML-escaped, CSV-quoted. */
function variants(value: string): string[] {
  const out = new Set<string>([value]);
  out.add(JSON.stringify(value).slice(1, -1));
  out.add(encodeURIComponent(value));
  out.add(value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  out.add(value.replace(/"/g, '""'));
  return [...out].filter((v) => v !== "");
}

/**
 * Replaces every occurrence of a secret value with `••••••`. Empty values are ignored.
 * Overlapping matches (one secret containing, or running into, another) become one mask.
 */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  if (!text || secrets.length === 0) return text;
  const needles = [...new Set(secrets.flatMap(variants))];
  if (needles.length === 0) return text;
  const ranges: [number, number][] = [];
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      ranges.push([at, at + needle.length]);
      from = at + 1;
    }
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "";
  let cursor = 0;
  let [start, end] = ranges[0];
  const flush = () => {
    out += text.slice(cursor, start) + SECRET_MASK;
    cursor = end;
  };
  for (const [s, e] of ranges.slice(1)) {
    if (s < end) end = Math.max(end, e);
    else {
      flush();
      [start, end] = [s, e];
    }
  }
  flush();
  return out + text.slice(cursor);
}

/** Masks both halves of a header list. */
export function maskHeaders(headers: [string, string][], secrets: readonly string[]): [string, string][] {
  return headers.map(([k, v]) => [maskSecrets(k, secrets), maskSecrets(v, secrets)]);
}

/** The values of the variables marked secret, across the given environments. */
export function secretValues(envs: readonly Environment[]): string[] {
  const out = new Set<string>();
  for (const env of envs) for (const v of env.vars) if (v.secret && v.value !== "") out.add(v.value);
  return [...out];
}

/** Secret values from the environments saved on this computer (all of them: a run may have used any). */
export function storedSecrets(): string[] {
  const envs = load<unknown>(ENVIRONMENTS_KEY, []);
  return Array.isArray(envs) ? secretValues(envs.filter((e): e is Environment => !!e && typeof e === "object" && Array.isArray((e as Environment).vars))) : [];
}

/** A function that masks text with the secrets saved right now. */
export function currentMasker(): (text: string) => string {
  const secrets = storedSecrets();
  return (text) => maskSecrets(text, secrets);
}
