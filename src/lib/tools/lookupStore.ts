import { MAX_HISTORY_BODY } from "../history";
import { redactRunForStorage } from "../redactStorage";
import { done, openDb, result, TOOL_LOOKUPS } from "../testing/testRunStore";
import type { ResponseResult } from "../types";
import type { LookupRecord } from "./types";

/** Recent lookups kept for each tool. Older ones are removed. */
export const MAX_LOOKUPS_PER_TOOL = 20;

/** All the response bodies of one saved lookup together stay under this many characters (a call that runs once per item adds up to 25 bodies). */
export const MAX_LOOKUP_BODIES = 1024 * 1024;

/** What an oldest body is replaced with when a lookup holds too much. */
export const BODY_DROPPED = "(body not kept: this lookup was too large to keep every response)";

function cutBodies<T extends { response?: ResponseResult }>(item: T, maxBody: number): T {
  return item.response && item.response.body.length > maxBody ? { ...item, response: { ...item.response, body: item.response.body.slice(0, maxBody) } } : item;
}

/**
 * Cuts response bodies to the size request history keeps, each item of a per-item call too. When the bodies of the whole
 * lookup are still more than `maxTotal`, the oldest bodies (by when they were sent) are dropped first.
 */
export function trimLookup(record: LookupRecord, maxBody = MAX_HISTORY_BODY, maxTotal = MAX_LOOKUP_BODIES): LookupRecord {
  const results = record.results.map((r) => {
    const cut = cutBodies(r, maxBody);
    return cut.each ? { ...cut, each: cut.each.map((e) => cutBodies(e, maxBody)) } : cut;
  });
  const refs: { at: string; size: number; drop: () => void }[] = [];
  const out = results.map((r) => {
    const copy = { ...r, ...(r.each ? { each: r.each.map((e) => ({ ...e })) } : {}) };
    if (copy.response) {
      const res = copy.response;
      refs.push({ at: copy.sentAt ?? record.startedAt, size: res.body.length, drop: () => (copy.response = { ...res, body: BODY_DROPPED }) });
    }
    copy.each?.forEach((e) => {
      const res = e.response;
      if (res) refs.push({ at: e.sentAt ?? copy.sentAt ?? record.startedAt, size: res.body.length, drop: () => (e.response = { ...res, body: BODY_DROPPED }) });
    });
    return copy;
  });
  let total = refs.reduce((n, r) => n + r.size, 0);
  if (total > maxTotal) {
    for (const r of [...refs].sort((a, b) => a.at.localeCompare(b.at))) {
      if (total <= maxTotal) break;
      r.drop();
      total -= r.size - BODY_DROPPED.length;
    }
  }
  return { ...record, results: out };
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
