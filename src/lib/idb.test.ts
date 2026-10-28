import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "./idb";

type Handler = (() => void) | null;

/** An IDBOpenDBRequest whose events the test fires by hand. */
function fakeFactory() {
  const req = { result: null as unknown, error: null, onupgradeneeded: null as Handler, onblocked: null as Handler, onsuccess: null as Handler, onerror: null as Handler };
  const db = { close: vi.fn(), onversionchange: null as Handler };
  req.result = db;
  const factory = { open: vi.fn(() => req) } as unknown as IDBFactory;
  return { factory, req, db };
}

describe("openDatabase", () => {
  it("resolves with the database and closes it when another window upgrades", async () => {
    const { factory, req, db } = fakeFactory();
    const onClosed = vi.fn();
    const p = openDatabase(factory, "x", 1, () => {}, onClosed, 1000);
    req.onsuccess!();
    expect(await p).toBe(db);
    db.onversionchange!();
    expect(db.close).toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalled();
  });

  it("rejects with a clear message when blocked by another window", async () => {
    const { factory, req } = fakeFactory();
    const p = openDatabase(factory, "x", 2, () => {}, () => {}, 1000);
    req.onblocked!();
    await expect(p).rejects.toThrow(/another REST Runner window/);
  });

  it("gives up after the timeout and closes a late connection", async () => {
    vi.useFakeTimers();
    try {
      const { factory, req, db } = fakeFactory();
      const p = openDatabase(factory, "x", 1, () => {}, () => {}, 50);
      const check = expect(p).rejects.toThrow(/did not open in time/);
      vi.advanceTimersByTime(60);
      await check;
      req.onsuccess!();
      expect(db.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
