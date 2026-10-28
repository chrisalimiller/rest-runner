/** How long to wait for the database before giving up, so a run never hangs on "Running". */
export const DB_TIMEOUT_MS = 5000;

const BLOCKED = "another REST Runner window is holding the run history open. Close it and try again.";
const SLOW = "the run history did not open in time. If another REST Runner window is open, close it and try again.";

/**
 * Opens an IndexedDB database without ever waiting forever:
 * - another window on an older version blocks the upgrade: rejects with a clear message;
 * - another window upgrades or deletes the database: this connection closes so it never blocks them,
 *   and the next call opens it again;
 * - the open is stuck behind something else (a pending delete): rejects after `timeoutMs`.
 */
export function openDatabase(
  indexedDb: IDBFactory,
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
  onClosed: () => void,
  timeoutMs = DB_TIMEOUT_MS,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let gaveUp = false;
    const fail = (error: Error) => {
      if (gaveUp) return;
      gaveUp = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(SLOW)), timeoutMs);
    const req = indexedDb.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onblocked = () => fail(new Error(BLOCKED));
    req.onsuccess = () => {
      const db = req.result;
      // Opened after we stopped waiting: let it go so it blocks nobody.
      if (gaveUp) return db.close();
      clearTimeout(timer);
      db.onversionchange = () => {
        db.close();
        onClosed();
      };
      resolve(db);
    };
    req.onerror = () => fail(req.error ?? new Error("the run history could not be opened."));
  });
}
