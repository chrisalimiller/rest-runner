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

/**
 * Runs `transform` over every record in the named stores and writes back the ones that changed
 * (compared as JSON). Returns how many records changed. A store or record that fails is left as it is.
 */
export async function rewriteStores(db: IDBDatabase, names: string[], transform: (record: unknown) => unknown): Promise<number> {
  let changed = 0;
  for (const name of names) {
    try {
      if (!db.objectStoreNames.contains(name)) continue;
      const all = await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });
      for (const record of all) {
        try {
          const next = transform(record);
          if (JSON.stringify(next) === JSON.stringify(record)) continue;
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(name, "readwrite");
            tx.objectStore(name).put(next);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
          changed++;
        } catch {
          /* leave this record as it is */
        }
      }
    } catch {
      /* leave this store as it is */
    }
  }
  return changed;
}
