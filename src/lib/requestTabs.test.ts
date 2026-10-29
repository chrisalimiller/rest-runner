import { describe, expect, it } from "vitest";
import { insertAt, newCollection, newFolder, requestNode, addExample, type Collection } from "./collections";
import { newRequest } from "./defaults";
import {
  activate,
  applyCurl,
  closeOthers,
  closeSaved,
  closeTab,
  curlPlan,
  discardTab,
  displayOrder,
  duplicateTab,
  goToTab,
  groupTabs,
  initialTabs,
  isTabDirty,
  loadTabs,
  mergeCurl,
  newTab,
  openInTab,
  pin,
  promote,
  reopenClosed,
  serializeTabs,
  stepTab,
  tabMonogram,
  tabShortcut,
  unpin,
  updateActiveDef,
  type TabsState,
} from "./requestTabs";
import type { RequestDef } from "./types";

const req = (name: string, over: Partial<RequestDef> = {}): RequestDef => ({ ...newRequest(), name, ...over });
const names = (s: TabsState) => s.tabs.map((t) => t.def.name);
const active = (s: TabsState) => s.tabs.find((t) => t.id === s.activeId)!;

/** Starts with one tab "A" and opens B, C, D permanently after it. */
function withTabs(...defs: RequestDef[]): TabsState {
  let s = initialTabs(defs[0]);
  for (const d of defs.slice(1)) s = openInTab(s, d, { preview: false });
  return s;
}

describe("openInTab", () => {
  it("activates a tab that already holds the request and keeps its edits", () => {
    const a = req("A");
    let s = withTabs(a, req("B"));
    s = updateActiveDef(s, { name: "B edited" });
    s = openInTab(s, a, { preview: false });
    expect(active(s).def.name).toBe("A");
    expect(s.tabs).toHaveLength(2);
    const b = s.tabs[1].def;
    s = openInTab(s, b, { preview: true });
    expect(active(s).def.name).toBe("B edited");
  });

  it("promotes a preview tab when opened permanently, keeps it when opened as preview", () => {
    let s = openInTab(initialTabs(req("A")), req("B"), { preview: true });
    const b = active(s).def;
    expect(active(s).preview).toBe(true);
    s = openInTab(s, b, { preview: true });
    expect(active(s).preview).toBe(true);
    s = openInTab(s, b, { preview: false });
    expect(active(s).preview).toBe(false);
  });

  it("replaces the preview tab in place with a fresh tab id", () => {
    let s = withTabs(req("A"));
    s = openInTab(s, req("B"), { preview: true });
    s = openInTab(s, req("C"), { preview: false });
    const before = s.tabs.find((t) => t.preview)!;
    s = openInTab(s, req("D"), { preview: true });
    expect(names(s)).toEqual(["A", "D", "C"]);
    expect(s.tabs.filter((t) => t.preview)).toHaveLength(1);
    expect(s.tabs.some((t) => t.id === before.id)).toBe(false);
    expect(active(s).def.name).toBe("D");
  });

  it("inserts after the active tab", () => {
    let s = withTabs(req("A"), req("B"), req("C"));
    s = activate(s, s.tabs[0].id);
    s = openInTab(s, req("X"), { preview: false });
    expect(names(s)).toEqual(["A", "X", "B", "C"]);
  });

  it("appends when the active tab is pinned", () => {
    let s = withTabs(req("A"), req("B"));
    s = pin(s, s.tabs[0].id);
    s = activate(s, s.tabs[0].id);
    s = openInTab(s, req("X"), { preview: false });
    expect(names(s)).toEqual(["A", "B", "X"]);
  });

  it("load replaces the working copy of an open tab", () => {
    const a = req("A");
    let s = updateActiveDef(initialTabs(a), { url: "edited" });
    s = openInTab(s, { ...a, url: "from history" }, { preview: false, load: true });
    expect(active(s).def.url).toBe("from history");
    expect(s.tabs).toHaveLength(1);
  });
});

describe("editing", () => {
  it("promotes a preview tab", () => {
    let s = openInTab(initialTabs(req("A")), req("B"), { preview: true });
    expect(active(s).preview).toBe(true);
    s = updateActiveDef(s, { url: "x" });
    expect(active(s).preview).toBe(false);
    expect(active(s).def.url).toBe("x");
  });
  it("promote leaves permanent tabs alone", () => {
    const s = initialTabs(req("A"));
    expect(promote(s, s.activeId)).toBe(s);
  });
});

describe("newTab", () => {
  it("adds a permanent Untitled request and activates it", () => {
    const s = newTab(initialTabs(req("A")));
    expect(names(s)).toEqual(["A", "Untitled request"]);
    expect(active(s).preview).toBe(false);
  });
});

describe("closeTab", () => {
  it("moves to the tab on the right, else the left", () => {
    let s = withTabs(req("A"), req("B"), req("C"));
    s = activate(s, s.tabs[1].id);
    s = closeTab(s, s.activeId);
    expect(active(s).def.name).toBe("C");
    s = closeTab(s, s.activeId);
    expect(active(s).def.name).toBe("A");
  });
  it("uses the display order when given", () => {
    let s = withTabs(req("A"), req("B"), req("C"));
    const [a, b, c] = s.tabs.map((t) => t.id);
    s = activate(s, b);
    s = closeTab(s, b, [c, b, a]);
    expect(s.activeId).toBe(a);
  });
  it("keeps the active tab when closing another", () => {
    let s = withTabs(req("A"), req("B"));
    const a = s.tabs[0].id;
    s = closeTab(s, a);
    expect(active(s).def.name).toBe("B");
  });
  it("pushes onto closed, most recent first, at most 10", () => {
    let s = withTabs(...Array.from({ length: 14 }, (_, i) => req(`T${i}`)));
    for (let i = 0; i < 12; i++) s = closeTab(s, s.tabs[0].id);
    expect(s.closed).toHaveLength(10);
    expect(s.closed[0].def.name).toBe("T11");
  });
  it("closing the last tab leaves one new Untitled tab", () => {
    let s = initialTabs(req("A"));
    s = closeTab(s, s.activeId);
    expect(s.tabs).toHaveLength(1);
    expect(active(s).def.name).toBe("Untitled request");
    expect(s.closed[0].def.name).toBe("A");
  });
});

describe("reopenClosed", () => {
  it("reopens the last closed tab at the end", () => {
    let s = withTabs(req("A"), req("B"), req("C"));
    s = closeTab(s, s.tabs[0].id);
    s = reopenClosed(s);
    expect(names(s)).toEqual(["B", "C", "A"]);
    expect(active(s).def.name).toBe("A");
    expect(s.closed).toHaveLength(0);
  });
  it("does nothing with nothing closed", () => {
    const s = initialTabs();
    expect(reopenClosed(s)).toBe(s);
  });
  it("keeps edits made before closing", () => {
    let s = withTabs(req("A"), req("B"));
    s = updateActiveDef(s, { url: "https://x" });
    s = closeTab(s, s.activeId);
    s = reopenClosed(s);
    expect(active(s).def.url).toBe("https://x");
  });
});

describe("pin and unpin", () => {
  it("pinned tabs keep their relative order at the front", () => {
    let s = withTabs(req("A"), req("B"), req("C"), req("D"));
    s = pin(s, s.tabs[2].id);
    s = pin(s, s.tabs[3].id);
    expect(names(s)).toEqual(["C", "D", "A", "B"]);
    expect(s.tabs.map((t) => t.pinned)).toEqual([true, true, false, false]);
  });
  it("unpin moves the tab to the front of the unpinned ones", () => {
    let s = withTabs(req("A"), req("B"), req("C"));
    s = pin(s, s.tabs[0].id);
    s = pin(s, s.tabs[2].id);
    s = unpin(s, s.tabs[0].id);
    expect(names(s)).toEqual(["C", "A", "B"]);
    expect(s.tabs.map((t) => t.pinned)).toEqual([true, false, false]);
  });
  it("pinning makes a preview permanent", () => {
    let s = openInTab(initialTabs(req("A")), req("B"), { preview: true });
    s = pin(s, s.activeId);
    expect(active(s).preview).toBe(false);
  });
});

describe("duplicateTab", () => {
  it("copies with a new id and name, after the original", () => {
    let s = withTabs(req("A"), req("B"));
    const orig = s.tabs[0];
    s = duplicateTab(s, orig.id);
    expect(names(s)).toEqual(["A", "A copy", "B"]);
    expect(s.tabs[1].def.id).not.toBe(orig.def.id);
    expect(active(s).def.name).toBe("A copy");
    expect(s.tabs[1].pinned).toBe(false);
  });
});

describe("closeOthers and closeSaved", () => {
  it("closeOthers keeps pinned tabs and the chosen tab", () => {
    let s = withTabs(req("A"), req("B"), req("C"), req("D"));
    s = pin(s, s.tabs[0].id);
    const keep = s.tabs[2].id;
    s = closeOthers(s, keep);
    expect(names(s)).toEqual(["A", "C"]);
    expect(s.activeId).toBe(keep);
    expect(s.closed).toHaveLength(2);
  });
  it("closeOthers can protect tabs", () => {
    const s = withTabs(req("A"), req("B"), req("C"));
    const next = closeOthers(s, s.tabs[0].id, (t) => t.def.name === "B");
    expect(names(next)).toEqual(["A", "B"]);
  });
  it("closeSaved never closes pinned or dirty tabs", () => {
    let s = withTabs(req("A"), req("B"), req("C"), req("D"));
    s = pin(s, s.tabs[0].id);
    const dirtyId = s.tabs[2].id;
    s = closeSaved(s, (t) => t.id === dirtyId);
    expect(names(s)).toEqual(["A", "C"]);
  });
  it("closeSaved with everything closable leaves a new tab", () => {
    const s = closeSaved(withTabs(req("A"), req("B")), () => false);
    expect(names(s)).toEqual(["Untitled request"]);
  });
});

describe("stepTab and goToTab", () => {
  it("steps with wrap-around and jumps by number", () => {
    const s = withTabs(req("A"), req("B"), req("C"));
    const order = s.tabs.map((t) => t.id);
    expect(stepTab(s, order, 1).activeId).toBe(order[0]);
    expect(stepTab(activate(s, order[0]), order, -1).activeId).toBe(order[2]);
    expect(goToTab(s, order, 2).activeId).toBe(order[1]);
    expect(goToTab(s, order, 9).activeId).toBe(order[2]);
    expect(goToTab(s, order, 5)).toBe(s);
  });
});

function sample(): { cols: Collection[]; ids: Record<string, string> } {
  const tt = newCollection("Trouble Ticket");
  const naap = newCollection("NaaP E-Bonding");
  const f1 = newFolder("Trouble Ticket");
  const f2 = newFolder("Health");
  const create = req("Create ticket");
  const get = req("Get ticket");
  const health = req("Health");
  const other = req("Other health");
  const root = req("At root");
  let cols = [tt, naap];
  cols = insertAt(cols, { collectionId: naap.id, folderId: null }, [f1]);
  cols = insertAt(cols, { collectionId: tt.id, folderId: null }, [f2, requestNode(root)]);
  cols = insertAt(cols, { collectionId: naap.id, folderId: f1.id }, [requestNode(create), requestNode(get)]);
  cols = insertAt(cols, { collectionId: tt.id, folderId: f2.id }, [requestNode(health)]);
  const f3 = newFolder("Trouble Ticket");
  cols = insertAt(cols, { collectionId: tt.id, folderId: null }, [f3]);
  cols = insertAt(cols, { collectionId: tt.id, folderId: f3.id }, [requestNode(other)]);
  return { cols, ids: { create: create.id, get: get.id, health: health.id, other: other.id, root: root.id, tt: tt.id, f1: f1.id, f2: f2.id, f3: f3.id } };
}

describe("groupTabs", () => {
  it("groups by direct folder, in first-appearance order, with Unsaved last", () => {
    const { cols } = sample();
    const find = (name: string): RequestDef => {
      const all: RequestDef[] = [];
      const walk = (items: any[]) => items.forEach((i) => (i.kind === "folder" ? walk(i.items) : all.push(i.request)));
      cols.forEach((c) => walk(c.items));
      return all.find((r) => r.name === name)!;
    };
    let s = initialTabs(req("Scratch"));
    s = openInTab(s, find("Health"), { preview: false });
    s = openInTab(s, find("Create ticket"), { preview: false });
    s = openInTab(s, req("Other scratch"), { preview: false });
    s = openInTab(s, find("Get ticket"), { preview: false });
    s = openInTab(s, find("At root"), { preview: false });
    const { pinned, groups } = groupTabs(s.tabs, cols);
    expect(pinned).toHaveLength(0);
    // The NaaP folder shares its name with the Trouble Ticket collection, so it gets the collection added.
    expect(groups.map((g) => g.label)).toEqual(["Health", "Trouble Ticket · NaaP E-Bonding", "Trouble Ticket", "Unsaved"]);
    expect(groups[1].tabs.map((t) => t.def.name)).toEqual(["Create ticket", "Get ticket"]);
    expect(groups[3].tabs.map((t) => t.def.name)).toEqual(["Scratch", "Other scratch"]);
  });

  it("adds the collection to groups that share a folder name", () => {
    const { cols, ids } = sample();
    const pick = (id: string) => {
      const out: RequestDef[] = [];
      const walk = (items: any[]) => items.forEach((i) => (i.kind === "folder" ? walk(i.items) : out.push(i.request)));
      cols.forEach((c) => walk(c.items));
      return out.find((r) => r.id === id)!;
    };
    let s = initialTabs(pick(ids.create));
    s = openInTab(s, pick(ids.other), { preview: false });
    const labels = groupTabs(s.tabs, cols).groups.map((g) => g.label);
    expect(labels).toEqual(["Trouble Ticket · NaaP E-Bonding", "Trouble Ticket · Trouble Ticket"]);
  });

  it("uses the collection for a request at its root", () => {
    const { cols, ids } = sample();
    const root = (cols[0].items.find((i) => i.kind === "request") as any).request as RequestDef;
    const g = groupTabs(initialTabs(root).tabs, cols).groups[0];
    expect(g.key).toBe(ids.tt);
    expect(g.label).toBe("Trouble Ticket");
  });

  it("puts an example in its request's group", () => {
    const { cols, ids } = sample();
    const r = addExample(cols, ids.root, "Ex", req("Ex"));
    const g = groupTabs(initialTabs(r.example.request).tabs, r.collections).groups[0];
    expect(g.key).toBe(ids.tt);
  });

  it("splits pinned tabs out and keeps open order inside a group", () => {
    const { cols } = sample();
    const all: RequestDef[] = [];
    const walk = (items: any[]) => items.forEach((i) => (i.kind === "folder" ? walk(i.items) : all.push(i.request)));
    cols.forEach((c) => walk(c.items));
    const g = (n: string) => all.find((r) => r.name === n)!;
    let s = withTabs(g("Get ticket"), g("Create ticket"));
    s = pin(s, s.tabs[0].id);
    const { pinned, groups } = groupTabs(s.tabs, cols);
    expect(pinned.map((t) => t.def.name)).toEqual(["Get ticket"]);
    expect(groups[0].tabs.map((t) => t.def.name)).toEqual(["Create ticket"]);
    expect(displayOrder(s.tabs, cols)).toHaveLength(2);
  });

  it("gives stable tones: neutral for Unsaved, never red", () => {
    const { cols, ids } = sample();
    const root = (cols[0].items.find((i) => i.kind === "request") as any).request as RequestDef;
    const a = groupTabs(initialTabs(root).tabs, cols).groups[0].tone;
    const b = groupTabs(initialTabs(root).tabs, cols).groups[0].tone;
    expect(a).toBe(b);
    expect(["purple", "blue", "green", "amber", "pink"]).toContain(a);
    expect(groupTabs(initialTabs(req("x")).tabs, cols).groups[0].tone).toBe("neutral");
    void ids;
  });

  it("recomputes after saving an unsaved tab into a collection", () => {
    const { cols, ids } = sample();
    const draft = req("Draft");
    const s = initialTabs(draft);
    expect(groupTabs(s.tabs, cols).groups[0].key).toBe("unsaved");
    const saved = insertAt(cols, { collectionId: ids.tt, folderId: null }, [requestNode(draft)]);
    expect(groupTabs(s.tabs, saved).groups[0].key).toBe(ids.tt);
  });
});

describe("tabMonogram", () => {
  it("takes initials of up to three words", () => {
    expect(tabMonogram("Get token", "GET")).toBe("GT");
    expect(tabMonogram("Get  token", "GET")).toBe("GT");
    expect(tabMonogram("a b c d", "GET")).toBe("ABC");
  });
  it("takes three letters of a single word", () => {
    expect(tabMonogram("Health", "GET")).toBe("HEA");
    expect(tabMonogram("Go", "GET")).toBe("GO");
  });
  it("falls back to the method without letters", () => {
    expect(tabMonogram("", "POST")).toBe("POST");
    expect(tabMonogram("123", "GET")).toBe("GET");
    expect(tabMonogram("  - ", "put")).toBe("PUT");
  });
  it("handles accented letters and ignores digits", () => {
    expect(tabMonogram("éclair", "GET")).toBe("ÉCL");
    expect(tabMonogram("Über Ärger", "GET")).toBe("ÜÄ");
    expect(tabMonogram("v2 users", "GET")).toBe("VU");
  });
});

describe("isTabDirty", () => {
  it("compares with the saved version; blank unsaved tabs are clean", () => {
    const { cols } = sample();
    const saved = (cols[0].items.find((i) => i.kind === "request") as any).request as RequestDef;
    expect(isTabDirty(initialTabs(saved).tabs[0], cols)).toBe(false);
    expect(isTabDirty(initialTabs({ ...saved, url: "x" }).tabs[0], cols)).toBe(true);
    expect(isTabDirty(initialTabs(newRequest()).tabs[0], cols)).toBe(false);
    expect(isTabDirty(initialTabs({ ...newRequest(), url: "x" }).tabs[0], cols)).toBe(true);
  });
});

describe("storage", () => {
  it("round-trips tabs, active, pinned and preview, but not closed", () => {
    let s = withTabs(req("A"), req("B"));
    s = openInTab(s, req("C"), { preview: true });
    s = pin(s, s.tabs[0].id);
    s = closeTab(s, s.tabs[1].id);
    const back = loadTabs(JSON.stringify(serializeTabs(s)), null);
    expect(back.tabs).toEqual(s.tabs);
    expect(back.activeId).toBe(s.activeId);
    expect(back.closed).toEqual([]);
    expect(serializeTabs(s).v).toBe(1);
  });

  it("migrates the old draft once when there are no tabs", () => {
    const draft = req("Old draft", { url: "https://old" });
    const s = loadTabs(null, draft);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].def).toEqual(draft);
    expect(s.tabs[0].pinned).toBe(false);
  });

  it("prefers the tabs key over the draft", () => {
    const s = initialTabs(req("Mine"));
    expect(loadTabs(JSON.stringify(serializeTabs(s)), req("Old")).tabs[0].def.name).toBe("Mine");
  });

  it("falls back to a single new tab on invalid data, without throwing", () => {
    const bad = [
      "not json",
      "null",
      "{}",
      JSON.stringify({ v: 2, activeId: "x", tabs: [] }),
      JSON.stringify({ v: 1, activeId: "x", tabs: [] }),
      JSON.stringify({ v: 1, activeId: "x", tabs: [{ id: "x" }] }),
      JSON.stringify({ v: 1, activeId: "x", tabs: [{ id: "x", def: { id: 1 } }] }),
    ];
    for (const raw of bad) {
      const s = loadTabs(raw, req("ignored draft"));
      expect(s.tabs).toHaveLength(1);
      expect(s.tabs[0].def.name).toBe("Untitled request");
    }
    expect(loadTabs(null, "garbage").tabs[0].def.name).toBe("Untitled request");
  });

  it("repairs an unknown active id and misplaced pins", () => {
    const a = req("A");
    const b = req("B");
    const raw = JSON.stringify({
      v: 1,
      activeId: "gone",
      tabs: [
        { id: "1", def: a, pinned: false, preview: false },
        { id: "2", def: b, pinned: true, preview: false },
      ],
    });
    const s = loadTabs(raw, null);
    expect(s.tabs.map((t) => t.id)).toEqual(["2", "1"]);
    expect(s.activeId).toBe("2");
  });
});

describe("tabShortcut", () => {
  const key = (code: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...o,
  });
  it("matches new, close and reopen with Ctrl or Cmd", () => {
    expect(tabShortcut(key("KeyT", { ctrlKey: true }))).toEqual({ type: "new" });
    expect(tabShortcut(key("KeyT", { metaKey: true }))).toEqual({ type: "new" });
    expect(tabShortcut(key("KeyT", { metaKey: true, shiftKey: true }))).toEqual({ type: "reopen" });
    expect(tabShortcut(key("KeyW", { ctrlKey: true }))).toEqual({ type: "close" });
    expect(tabShortcut(key("KeyW", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(tabShortcut(key("KeyT"))).toBeNull();
  });
  it("matches Ctrl+Tab and Ctrl+Shift+Tab only with Ctrl", () => {
    expect(tabShortcut(key("Tab", { ctrlKey: true }))).toEqual({ type: "next" });
    expect(tabShortcut(key("Tab", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "prev" });
    expect(tabShortcut(key("Tab"))).toBeNull();
    expect(tabShortcut(key("Tab", { metaKey: true }))).toBeNull();
  });
  it("matches Mod+Alt+digit, and leaves Mod+digit to sections", () => {
    expect(tabShortcut(key("Digit2", { ctrlKey: true, altKey: true }))).toEqual({ type: "goto", n: 2 });
    expect(tabShortcut(key("Digit9", { metaKey: true, altKey: true }))).toEqual({ type: "goto", n: 9 });
    expect(tabShortcut(key("Digit0", { metaKey: true, altKey: true }))).toBeNull();
    expect(tabShortcut(key("Digit2", { ctrlKey: true }))).toBeNull();
  });
  it("uses the physical key, not the character", () => {
    expect(tabShortcut({ ...key("KeyT", { ctrlKey: true }), key: "é" } as never)).toEqual({ type: "new" });
  });
});

describe("loadTabs with partly broken requests", () => {
  it("fills in missing parts of a stored request instead of crashing later", () => {
    const def = { id: "r", name: "Old", method: "GET", url: "u", params: [], headers: [] };
    const raw = JSON.stringify({ v: 1, activeId: "t", tabs: [{ id: "t", def }] });
    const s = loadTabs(raw, null);
    expect(s.tabs[0].def.auth).toEqual({ type: "none" });
    expect(s.tabs[0].def.formBody).toHaveLength(1);
    expect(s.tabs[0].def.bodyMode).toBe("none");
  });
});

describe("pasted cURL", () => {
  const parsed = req("POST orders", { method: "POST", url: "https://a.test/orders", bodyMode: "json", body: "{}" });
  const never = () => false;

  it("fills a blank, unsaved active tab in place", () => {
    const s = initialTabs();
    const blankId = active(s).def.id;
    const plan = curlPlan(s, "auto", never);
    expect(plan.mode).toBe("fill");
    const r = applyCurl(s, plan, mergeCurl(plan, active(s).def, parsed));
    expect(r.state.tabs).toHaveLength(1);
    expect(active(r.state).def).toMatchObject({ id: blankId, name: "POST orders", url: "https://a.test/orders" });
    expect(r.before).toBe(s.tabs[0].def);
  });

  it("opens a new tab after the active one when the active tab has work in it", () => {
    const s = withTabs(req("A", { url: "https://x.test" }), req("B"));
    const plan = curlPlan(s, "auto", never);
    expect(plan.mode).toBe("new");
    const r = applyCurl(s, plan, mergeCurl(plan, undefined, parsed));
    expect(names(r.state)).toEqual(["A", "B", "POST orders"]);
    expect(r.state.activeId).toBe(r.tabId);
    expect(r.before).toBeNull();
    expect(active(r.state).preview).toBe(false);
    // The old tabs are untouched.
    expect(r.state.tabs[0]).toBe(s.tabs[0]);
  });

  it("does not fill a blank tab that is saved", () => {
    const s = initialTabs();
    expect(curlPlan(s, "auto", () => true).mode).toBe("new");
  });

  it("'new' always opens a tab, 'active' always replaces", () => {
    const s = initialTabs();
    expect(curlPlan(s, "new", never).mode).toBe("new");
    const used = withTabs(req("A", { name: "Keep me", url: "https://x.test", preScript: "rr.log(1)", noCertificate: true }));
    const plan = curlPlan(used, "active", never);
    expect(plan.mode).toBe("replace");
    const merged = mergeCurl(plan, active(used).def, parsed);
    expect(merged).toMatchObject({ id: active(used).def.id, name: "Keep me", preScript: "rr.log(1)", noCertificate: true, method: "POST", url: "https://a.test/orders", body: "{}" });
    const r = applyCurl(used, plan, merged);
    expect(r.state.tabs).toHaveLength(1);
    expect(r.before).toBe(used.tabs[0].def);
  });

  it("discardTab removes a tab without offering it for reopen", () => {
    const s = withTabs(req("A"), req("B"));
    const r = discardTab(s, active(s).id);
    expect(names(r)).toEqual(["A"]);
    expect(r.closed).toEqual([]);
    const only = initialTabs();
    expect(names(discardTab(only, only.activeId))).toEqual(["Untitled request"]);
  });
});
