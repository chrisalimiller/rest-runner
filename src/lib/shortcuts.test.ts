import { describe, expect, it } from "vitest";
import { formatKeys, matchesShortcut, SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts";

const ev = (o: Partial<KeyboardEvent>) => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe("shortcut registry", () => {
  it("has unique ids and keys, and only known groups", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    expect(new Set(SHORTCUTS.map((s) => s.keys)).size).toBe(SHORTCUTS.length);
    for (const s of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(s.group);
    for (const g of SHORTCUT_GROUPS) expect(SHORTCUTS.some((s) => s.group === g)).toBe(true);
  });

  it("formats keys per platform", () => {
    expect(formatKeys("Mod+Shift+T", false)).toBe("Ctrl+Shift+T");
    expect(formatKeys("Mod+Shift+T", true)).toBe("⌘ ⇧ T");
  });

  it("matches the keys that handlers use it for, and not near misses", () => {
    expect(matchesShortcut("quick-open", ev({ key: "k", ctrlKey: true }))).toBe(true);
    expect(matchesShortcut("quick-open", ev({ key: "K", metaKey: true }))).toBe(true);
    expect(matchesShortcut("quick-open", ev({ key: "k", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesShortcut("quick-open", ev({ key: "k" }))).toBe(false);
    expect(matchesShortcut("send", ev({ key: "Enter", ctrlKey: true }))).toBe(true);
    expect(matchesShortcut("send", ev({ key: "Enter" }))).toBe(false);
    expect(matchesShortcut("save", ev({ key: "s", metaKey: true }))).toBe(true);
    expect(matchesShortcut("rename", ev({ key: "F2" }))).toBe(true);
    expect(matchesShortcut("rename", ev({ key: "F2", ctrlKey: true }))).toBe(false);
    expect(matchesShortcut("keyboard-shortcuts", ev({ key: "?", shiftKey: true }))).toBe(true);
    expect(matchesShortcut("keyboard-shortcuts", ev({ key: "?", ctrlKey: true }))).toBe(false);
    expect(matchesShortcut("nope", ev({ key: "k", ctrlKey: true }))).toBe(false);
  });

  it("matches every simple registry entry by its own keys", () => {
    const skip = new Set(["goto-tab", "next-tab", "prev-tab", "complete"]); // handled by key code or by an editor
    for (const s of SHORTCUTS) {
      if (skip.has(s.id)) continue;
      const parts = s.keys.split("+");
      const key = parts[parts.length - 1];
      const e = ev({
        key: key === "Esc" ? "Escape" : key,
        ctrlKey: parts.includes("Mod") || parts.includes("Ctrl"),
        altKey: parts.includes("Alt"),
        shiftKey: parts.includes("Shift"),
      });
      expect(matchesShortcut(s.id, e), s.id).toBe(true);
    }
  });
});
