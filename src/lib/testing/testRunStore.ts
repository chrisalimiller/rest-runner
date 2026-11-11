import { openDatabase, rewriteStores } from "../idb";
import { redactRunForStorage } from "../redactStorage";
import { testRunSummary, type TestRun, type TestRunSummary } from "./testRun";

/** Test runs live in their own IndexedDB database, next to batch runs. Oldest are removed past this count. */
export const MAX_SAVED_TEST_RUNS = 50;

const DB_NAME = "rest-runner-tests";
const SUMMARIES = "summaries";
const RUNS = "runs";
/** Flow runs share this database (added in version 2). */
export const FLOW_SUMMARIES = "flow-summaries";
export const FLOW_RUNS = "flow-runs";
/** Tool lookups share this database too (added in version 3). */
export const TOOL_LOOKUPS = "tool-lookups";
const STORES = [SUMMARIES, RUNS, FLOW_SUMMARIES, FLOW_RUNS, TOOL_LOOKUPS];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase(
      indexedDB,
      DB_NAME,
      3,
      (db) => {
        for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      },
      () => {
        dbPromise = null;
      },
    ).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Newest first. */
export async function listTestRuns(): Promise<TestRunSummary[]> {
  const db = await openDb();
  const all = await result(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll() as IDBRequest<TestRunSummary[]>);
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getTestRun(id: string): Promise<TestRun | undefined> {
  const db = await openDb();
  return result(db.transaction(RUNS).objectStore(RUNS).get(id) as IDBRequest<TestRun | undefined>);
}

export async function deleteTestRun(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, RUNS], "readwrite");
  tx.objectStore(SUMMARIES).delete(id);
  tx.objectStore(RUNS).delete(id);
  await done(tx);
}

export async function saveTestRun(live: TestRun): Promise<void> {
  // Only the stored copy is redacted; the caller keeps showing the live run.
  const run = redactRunForStorage(live);
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, RUNS], "readwrite");
  tx.objectStore(SUMMARIES).put(testRunSummary(run));
  tx.objectStore(RUNS).put(run);
  await done(tx);
  const runs = await listTestRuns();
  for (const old of runs.slice(MAX_SAVED_TEST_RUNS)) await deleteTestRun(old.id);
}

/** Rewrites every saved test run and flow run (and summary) through `transform`; returns how many changed. */
export async function rewriteSavedTestAndFlowRuns(transform: (record: unknown) => unknown): Promise<number> {
  return rewriteStores(await openDb(), STORES, transform);
}
