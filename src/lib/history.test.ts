import { describe, expect, it } from "vitest";
import { newRequest } from "./defaults";
import { cleanHistory, fitHistory, historyLabel, historyOutcome, responseNotKept } from "./history";
import type { HistoryEntry } from "./types";

const now = new Date("2026-10-22T14:00:00");
function entry(p: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id: "h1", method: "GET", url: "http://x/a", status: 200, sentAt: "2026-10-22T13:41:00", def: newRequest(), ...p };
}
const response = { status: 201, statusText: "Created", headers: [] as [string, string][], body: "{}", sizeBytes: 2, durationMs: 142 };

describe("historyOutcome", () => {
  it("shows the kept response", () => {
    const o = historyOutcome(entry({ response }));
    expect(o.ok && o.response.status).toBe(201);
  });
  it("shows the error of a failed send", () => {
    const o = historyOutcome(entry({ status: null, error: "refused", durationMs: 9 }));
    expect(o.ok).toBe(false);
    expect(!o.ok && o.error).toBe("refused");
  });
  it("still shows the status of an older entry with no response", () => {
    const h = entry({ status: 404 });
    const o = historyOutcome(h);
    expect(o.ok && o.response.status).toBe(404);
    expect(responseNotKept(h)).toBe(true);
  });
  it("gives a failed send with no error text a reason", () => {
    const o = historyOutcome(entry({ status: null }));
    expect(!o.ok && o.error).toMatch(/No response/);
  });
});

describe("historyLabel", () => {
  it("names the time and duration", () => {
    expect(historyLabel(entry({ response, durationMs: 142 }), now)).toBe("Sent 19m ago · 142 ms");
  });
  it("says when the response was not kept", () => {
    expect(historyLabel(entry(), now)).toBe("Sent 19m ago · response not kept");
  });
  it("says when the body was cut", () => {
    expect(historyLabel(entry({ response: { ...response, sizeBytes: 40_000 } }), now)).toBe("Sent 19m ago · body cut to 32 KB");
  });
});

describe("fitHistory", () => {
  const list = [entry({ id: "new", response }), entry({ id: "mid", response }), entry({ id: "old", response })];
  it("keeps the list when it fits", () => {
    expect(fitHistory(list, () => true)).toBe(list);
  });
  it("drops responses from the oldest entries first", () => {
    const fits = (h: HistoryEntry[]) => h.filter((x) => x.response).length <= 1;
    const out = fitHistory(list, fits)!;
    expect(out.map((h) => !!h.response)).toEqual([true, false, false]);
    expect(out.map((h) => h.id)).toEqual(["new", "mid", "old"]);
  });
  it("returns null when nothing fits", () => {
    expect(fitHistory(list, () => false)).toBeNull();
  });
});

describe("cleanHistory", () => {
  it("drops broken entries and keeps good ones", () => {
    const good = { id: "h1", method: "GET", url: "u", status: 200, sentAt: "2026-01-01T00:00:00Z", def: { id: "r", url: "u", method: "GET", params: [], headers: [] } };
    expect(cleanHistory(null)).toEqual([]);
    expect(cleanHistory({})).toEqual([]);
    const out = cleanHistory([null, 5, { id: "x" }, good, { ...good, id: "h2", response: "bad", status: "?" }]);
    expect(out.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(out[0].def.formBody).toHaveLength(1);
    expect(out[1].response).toBeUndefined();
    expect(out[1].status).toBeNull();
  });
});
