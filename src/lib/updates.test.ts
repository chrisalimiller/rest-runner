import { describe, expect, it } from "vitest";
import { downloadPercent, friendlyUpdateError, plainNotes, releaseDate, updatesAvailable, versionLabel } from "./updates";
import { isBusy, setBusy } from "./busyWork";

describe("updates wording", () => {
  it("labels versions with one v", () => {
    expect(versionLabel("0.3.0")).toBe("v0.3.0");
    expect(versionLabel("v0.3.0")).toBe("v0.3.0");
    expect(versionLabel("")).toBe("");
  });
  it("formats the release date and ignores bad ones", () => {
    expect(releaseDate("2026-11-12T10:00:00Z")).toBe("12 Nov 2026");
    expect(releaseDate("nonsense")).toBe("");
    expect(releaseDate(undefined)).toBe("");
  });
  it("computes progress only when the size is known", () => {
    expect(downloadPercent(50, 200)).toBe(25);
    expect(downloadPercent(500, 200)).toBe(100);
    expect(downloadPercent(5, undefined)).toBeNull();
    expect(downloadPercent(5, 0)).toBeNull();
  });
  it("cleans release notes", () => {
    expect(plainNotes("## What's new\r\n**Bold** item")).toBe("What's new\nBold item");
    expect(plainNotes(undefined)).toBe("");
  });
  it("explains errors", () => {
    expect(friendlyUpdateError(new Error("error sending request for url"))).toMatch(/Could not reach GitHub/);
    expect(friendlyUpdateError("signature verification failed")).toMatch(/signature/);
    expect(friendlyUpdateError(new Error("boom"))).toBe("The update failed: boom");
    expect(friendlyUpdateError("")).toMatch(/unknown/);
  });
  it("only updates installed builds", () => {
    expect(updatesAvailable(true, false)).toBe(true);
    expect(updatesAvailable(true, true)).toBe(false);
    expect(updatesAvailable(false, false)).toBe(false);
  });
});

describe("busyWork", () => {
  it("is busy while any source runs", () => {
    expect(isBusy()).toBe(false);
    setBusy("a", true);
    setBusy("b", true);
    setBusy("a", false);
    expect(isBusy()).toBe(true);
    setBusy("b", false);
    expect(isBusy()).toBe(false);
  });
});
