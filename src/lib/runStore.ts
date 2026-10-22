import { summaryOf, type Run, type RunSummary } from "./run";

/** Saved runs live in IndexedDB, which has room for large runs. Oldest runs are removed past this count. */
export const MAX_SAVED_RUNS = 30;

const DB_NAME = "rest-runner";
const DB_VERSION = 1;
const SUMMARIES = "runSummaries";
const RUNS = "runs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Newest first. */
export async function listRuns(): Promise<RunSummary[]> {
  const db = await openDb();
  const all = await result(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll() as IDBRequest<RunSummary[]>);
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getRun(id: string): Promise<Run | undefined> {
  const db = await openDb();
  return result(db.transaction(RUNS).objectStore(RUNS).get(id) as IDBRequest<Run | undefined>);
}

export async function deleteRun(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, RUNS], "readwrite");
  tx.objectStore(SUMMARIES).delete(id);
  tx.objectStore(RUNS).delete(id);
  await done(tx);
}

/** Saves a run, then removes the oldest runs past MAX_SAVED_RUNS. */
export async function saveRun(run: Run): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, RUNS], "readwrite");
  tx.objectStore(SUMMARIES).put(summaryOf(run));
  tx.objectStore(RUNS).put(run);
  await done(tx);
  const runs = await listRuns();
  for (const old of runs.slice(MAX_SAVED_RUNS)) await deleteRun(old.id);
}
