import { testRunSummary, type TestRun, type TestRunSummary } from "./testRun";

/** Test runs live in their own IndexedDB database, next to batch runs. Oldest are removed past this count. */
export const MAX_SAVED_TEST_RUNS = 50;

const DB_NAME = "rest-runner-tests";
const SUMMARIES = "summaries";
const RUNS = "runs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
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

export async function saveTestRun(run: TestRun): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, RUNS], "readwrite");
  tx.objectStore(SUMMARIES).put(testRunSummary(run));
  tx.objectStore(RUNS).put(run);
  await done(tx);
  const runs = await listTestRuns();
  for (const old of runs.slice(MAX_SAVED_TEST_RUNS)) await deleteTestRun(old.id);
}
