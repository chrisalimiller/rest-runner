import { load, save } from "./storage";

export const RECENT_ENVS_KEY = "rest-runner.recent-environments";
export const MAX_RECENT_ENVS = 5;

/** Moves `id` to the front of the recent list, without duplicates, capped at `max`. */
export function pushRecent(recent: readonly string[], id: string, max = MAX_RECENT_ENVS): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

export function loadRecentEnvs(): string[] {
  return load<string[]>(RECENT_ENVS_KEY, [], (x) => Array.isArray(x) && x.every((v) => typeof v === "string"));
}

export function saveRecentEnvs(ids: string[]): boolean {
  return save(RECENT_ENVS_KEY, ids);
}

/** Case-insensitive substring filter on names; an empty query keeps everything. */
export function filterEnvs<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : [...items];
}

/** Recent environments that still exist, most recent first (stale ids dropped). */
export function recentEnvs<T extends { id: string }>(items: readonly T[], recent: readonly string[], max = MAX_RECENT_ENVS): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  for (const id of recent) {
    const item = byId.get(id);
    if (item) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}
