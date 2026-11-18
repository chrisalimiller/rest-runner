import type { RequestDef } from "../types";

/** The value with object keys sorted and `undefined` fields dropped, so key order and absent-vs-undefined do not matter. */
function normal(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normal);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normal(x);
    }
    return out;
  }
  return v;
}

/**
 * True when a case's copy of a request still matches the saved request it came from.
 * The id is ignored (a copy gets its own); key order does not matter. Fields missing on older
 * saved requests (scripts, noCertificate) count as their empty value, so they do not show as a change.
 */
export function sameRequest(copy: RequestDef, saved: RequestDef): boolean {
  const pick = (r: RequestDef) => {
    const { id: _id, ...rest } = r;
    void _id;
    return normal({ ...rest, preScript: rest.preScript ?? "", postScript: rest.postScript ?? "", noCertificate: rest.noCertificate ?? false });
  };
  return JSON.stringify(pick(copy)) === JSON.stringify(pick(saved));
}
