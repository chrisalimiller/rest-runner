import { beforeEach, describe, expect, it } from "vitest";
import { certExpiresSoon, getSectionStatus, markSectionSeen, railBadge, resetSectionStatus, setRequestStatus, setSectionStatus } from "./sectionStatus";

const NOW = Date.UTC(2026, 10, 6);
const DAY = 86_400_000;
const secs = (ms: number) => ms / 1000;

beforeEach(() => resetSectionStatus());

describe("railBadge", () => {
  it("shows failed cases for Testing until seen", () => {
    setSectionStatus("testing", { failed: 8, unseen: true });
    expect(railBadge("testing", getSectionStatus(), NOW)).toEqual({ kind: "pill", text: "8✕", tone: "bad" });
    markSectionSeen("testing");
    expect(railBadge("testing", getSectionStatus(), NOW)).toBeNull();
  });

  it("caps the failure count at 99+", () => {
    setSectionStatus("testing", { failed: 100, unseen: true });
    expect(railBadge("testing", getSectionStatus(), NOW)?.text).toBe("99+✕");
    setSectionStatus("testing", { failed: 99 });
    expect(railBadge("testing", getSectionStatus(), NOW)?.text).toBe("99✕");
  });

  it("shows nothing for a finished run without failures", () => {
    setSectionStatus("testing", { failed: 0, unseen: true });
    expect(railBadge("testing", getSectionStatus(), NOW)).toBeNull();
  });

  it("running takes precedence over a failure badge", () => {
    setSectionStatus("testing", { failed: 3, unseen: true, running: true });
    expect(railBadge("testing", getSectionStatus(), NOW)).toEqual({ kind: "pill", text: "●", tone: "accent" });
  });

  it("flows: green dot while running, ✕ after a failed run until seen", () => {
    setSectionStatus("flows", { running: true });
    expect(railBadge("flows", getSectionStatus(), NOW)).toEqual({ kind: "pill", text: "●", tone: "ok" });
    setSectionStatus("flows", { running: false, failed: 1, unseen: true });
    expect(railBadge("flows", getSectionStatus(), NOW)).toEqual({ kind: "pill", text: "✕", tone: "bad" });
    markSectionSeen("flows");
    expect(railBadge("flows", getSectionStatus(), NOW)).toBeNull();
  });

  it("tools: accent dot while looking up, ✕ after a lookup with problems until seen", () => {
    setSectionStatus("tools", { running: true });
    expect(railBadge("tools", getSectionStatus(), NOW)).toEqual({ kind: "pill", text: "●", tone: "accent" });
    setSectionStatus("tools", { running: false, failed: 2, unseen: true });
    expect(railBadge("tools", getSectionStatus(), NOW)).toEqual({ kind: "pill", text: "✕", tone: "bad" });
    markSectionSeen("tools");
    expect(railBadge("tools", getSectionStatus(), NOW)).toBeNull();
  });

  it("variables: the unfilled count", () => {
    expect(railBadge("variables", getSectionStatus(), NOW)).toBeNull();
    setRequestStatus({ unfilled: 0, certInUse: null, url: "", skipped: false, onSkip: null });
    expect(railBadge("variables", getSectionStatus(), NOW)).toBeNull();
    setRequestStatus({ unfilled: 1, certInUse: null, url: "", skipped: false, onSkip: null });
    expect(railBadge("variables", getSectionStatus(), NOW)).toEqual({ kind: "pill", text: "1", tone: "warn" });
  });

  it("certificates: green when in use, amber when expiring (amber wins)", () => {
    setRequestStatus({ unfilled: 0, certInUse: "naap-sit-client", url: "", skipped: false, onSkip: null });
    expect(railBadge("certificates", getSectionStatus(), NOW)).toEqual({ kind: "dot", text: "", tone: "ok" });
    const soon = secs(NOW + 10 * DAY);
    expect(railBadge("certificates", { ...getSectionStatus(), certNotAfter: [soon] }, NOW)).toEqual({ kind: "dot", text: "", tone: "warn" });
    resetSectionStatus();
    expect(railBadge("certificates", { ...getSectionStatus(), certNotAfter: [soon] }, NOW)?.tone).toBe("warn");
  });

  it("requests has no badge", () => {
    expect(railBadge("requests", getSectionStatus(), NOW)).toBeNull();
  });
});

describe("certExpiresSoon", () => {
  it("is false at exactly 30 days and true just inside", () => {
    expect(certExpiresSoon([secs(NOW + 30 * DAY)], NOW)).toBe(false);
    expect(certExpiresSoon([secs(NOW + 30 * DAY - 1000)], NOW)).toBe(true);
  });
  it("counts expired certificates and ignores far ones", () => {
    expect(certExpiresSoon([secs(NOW - DAY)], NOW)).toBe(true);
    expect(certExpiresSoon([secs(NOW + 90 * DAY)], NOW)).toBe(false);
    expect(certExpiresSoon([], NOW)).toBe(false);
  });
});
