import type { ToolCall } from "./types";

/** The calls whose fields `call` maps a placeholder to. Only placeholders in `only` count when given. */
export function callDependencies(call: ToolCall, only?: readonly string[] | null): string[] {
  const out = new Set<string>();
  for (const [placeholder, m] of Object.entries(call.mappings)) {
    if (only && !only.includes(placeholder)) continue;
    if (m.call && m.call.callId !== "") out.add(m.call.callId);
  }
  return [...out];
}

export type CallOrder =
  | {
      ok: true;
      /** Calls so each comes after the calls it needs. */
      order: ToolCall[];
      /** Calls that could start together: a level needs only calls of lower levels. */
      levels: ToolCall[][];
    }
  | { ok: false; /** Call ids going round the loop, the first one repeated at the end. */ cycle: string[]; message: string };

/**
 * Puts calls in dependency order. Call A depends on call B when a placeholder of A maps to a field of B.
 * `placeholdersOf` returns the placeholders a call's request really uses (so a stale mapping cannot
 * make a false loop); null means unknown, and every mapping counts. Dependencies on ids that are not
 * calls of the tool are ignored here (the engine skips such a call).
 */
export function orderCalls(calls: readonly ToolCall[], placeholdersOf?: (call: ToolCall) => readonly string[] | null): CallOrder {
  const byId = new Map(calls.map((c) => [c.id, c]));
  const deps = new Map<string, string[]>();
  for (const c of calls) deps.set(c.id, callDependencies(c, placeholdersOf?.(c)).filter((d) => byId.has(d)));

  const level = new Set<string>();
  const remaining = new Set(calls.map((c) => c.id));
  const levels: ToolCall[][] = [];
  while (remaining.size > 0) {
    // Keep the tool's own order inside a level.
    const layer = calls.filter((c) => remaining.has(c.id) && deps.get(c.id)!.every((d) => level.has(d)));
    if (layer.length === 0) break;
    for (const c of layer) {
      level.add(c.id);
      remaining.delete(c.id);
    }
    levels.push(layer);
  }
  if (remaining.size === 0) return { ok: true, order: levels.flat(), levels };

  const cycle = findCycle(deps, remaining);
  const name = (id: string) => byId.get(id)?.name || "(unnamed call)";
  const message =
    cycle.length === 2
      ? `${name(cycle[0])} needs its own result.`
      : "These calls wait on each other: " + cycle.slice(0, -1).map((id, i) => `${name(id)} needs ${name(cycle[i + 1])}`).join(", ") + ".";
  return { ok: false, cycle, message };
}

function findCycle(deps: Map<string, string[]>, among: Set<string>): string[] {
  // Every call left over needs another left-over call, so following needs must come back round.
  const seen = new Map<string, number>();
  const path: string[] = [];
  let at = [...among][0];
  while (!seen.has(at)) {
    seen.set(at, path.length);
    path.push(at);
    at = deps.get(at)!.find((d) => among.has(d))!;
  }
  return [...path.slice(seen.get(at)!), at];
}
