import { MAX_HISTORY_BODY } from "../history";
import { redactRunForStorage } from "../redactStorage";
import { done, openDb, result, TOOL_LOOKUPS } from "../testing/testRunStore";
import type { LookupRecord } from "./types";

/** Recent lookups kept for each tool. Older ones are removed. */
export const MAX_LOOKUPS_PER_TOOL = 20;

/** Cuts response bodies to the size request history keeps. */
export function trimLookup(record: LookupRecord, maxBody = MAX_HISTORY_BODY): LookupRecord {
  return {
    ...record,
    results: record.results.map((r) =>
      r.response && r.response.body.length > maxBody ? { ...r, response: { ...r.response, body: r.response.body.slice(0, maxBody) } } : r,
    ),
  };
}

/**
 * The copy that is written to storage: bodies cut like request history, then secret environment values masked
 * with the same rules as saved runs. The caller keeps showing the live record.
 */
export function lookupForStorage(record: LookupRecord, secrets?: readonly string[]): LookupRecord {
  return redactRunForStorage(trimLookup(record), secrets);
}

/** The ids to remove so only the newest `max` of one tool's lookups stay. */
export function expiredLookupIds(records: readonly Pick<LookupRecord, "id" | "startedAt">[], max = MAX_LOOKUPS_PER_TOOL): string[] {
  return [...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(max).map((r) => r.id);
}

/** Newest first. */
export async function listLookups(toolId: string): Promise<LookupRecord[]> {
  const db = await openDb();
  const all = await result(db.transaction(TOOL_LOOKUPS).objectStore(TOOL_LOOKUPS).getAll() as IDBRequest<LookupRecord[]>);
  return all.filter((r) => r.toolId === toolId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * Saves a lookup and removes the tool's oldest ones past MAX_LOOKUPS_PER_TOOL.
 * With `keepHistory` false (the tool's keep-nothing switch) nothing is written. Returns whether it was saved.
 */
export async function saveLookup(live: LookupRecord, keepHistory = true): Promise<boolean> {
  if (!keepHistory) return false;
  const record = lookupForStorage(live);
  const db = await openDb();
  const tx = db.transaction(TOOL_LOOKUPS, "readwrite");
  tx.objectStore(TOOL_LOOKUPS).put(record);
  await done(tx);
  const old = expiredLookupIds(await listLookups(record.toolId));
  if (old.length > 0) await deleteLookups(old);
  return true;
}

export async function deleteLookups(ids: string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(TOOL_LOOKUPS, "readwrite");
  for (const id of ids) tx.objectStore(TOOL_LOOKUPS).delete(id);
  await done(tx);
}

/** Clear history: removes every saved lookup of one tool (also used when the tool is deleted or set to keep nothing). */
export async function clearLookups(toolId: string): Promise<void> {
  await deleteLookups((await listLookups(toolId)).map((r) => r.id));
}
