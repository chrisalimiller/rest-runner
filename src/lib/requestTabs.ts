import { isRequestDef, locate, type Collection } from "./collections";
import { completeRequest, newRequest } from "./defaults";
import { newId } from "./ids";
import type { RequestDef } from "./types";

/**
 * Open-request tabs. The Requests section keeps several working copies open at once.
 * Everything here is pure: the app holds a TabsState and swaps in the result.
 *
 * Pinned tabs always sit at the front of `tabs`. A tab opened by a single click is a
 * "preview": the next single-click open replaces it, and editing it makes it permanent.
 */

export interface RequestTab {
  /** Tab id (newId()). */
  id: string;
  /** The working copy. def.id is the saved request or example id, or a fresh id for an unsaved one. */
  def: RequestDef;
  pinned: boolean;
  /** Opened by a single click; replaced by the next single-click open. */
  preview: boolean;
}

export interface TabsState {
  tabs: RequestTab[];
  activeId: string;
  /** Recently closed tabs, most recent first. Not persisted. */
  closed: RequestTab[];
}

export const MAX_CLOSED = 10;
export const TABS_VERSION = 1;

export type GroupTone = "purple" | "blue" | "green" | "amber" | "pink" | "neutral";
const TONES: Exclude<GroupTone, "neutral">[] = ["purple", "blue", "green", "amber", "pink"];

export const UNSAVED_KEY = "unsaved";

function makeTab(def: RequestDef, over: Partial<RequestTab> = {}): RequestTab {
  return { id: newId(), def, pinned: false, preview: false, ...over };
}

export function initialTabs(def: RequestDef = newRequest()): TabsState {
  const tab = makeTab(def);
  return { tabs: [tab], activeId: tab.id, closed: [] };
}

const activeIndex = (s: TabsState) => s.tabs.findIndex((t) => t.id === s.activeId);

/** Inserts a tab after the active one, or at the end when the active tab is pinned. */
function insertTab(s: TabsState, tab: RequestTab): TabsState {
  const i = activeIndex(s);
  const at = i < 0 || s.tabs[i].pinned ? s.tabs.length : i + 1;
  return { ...s, tabs: [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)], activeId: tab.id };
}

export interface OpenOptions {
  /** A single-click open: reuses the preview tab. */
  preview: boolean;
  /** When a tab already holds this request, replace its working copy instead of keeping its edits (history, "load this request"). */
  load?: boolean;
}

export function openInTab(s: TabsState, def: RequestDef, { preview, load }: OpenOptions): TabsState {
  const existing = s.tabs.find((t) => t.def.id === def.id);
  if (existing) {
    return {
      ...s,
      activeId: existing.id,
      tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, def: load ? structuredClone(def) : t.def, preview: t.preview && preview } : t)),
    };
  }
  const copy = structuredClone(def);
  const previewTab = preview ? s.tabs.find((t) => t.preview && !t.pinned) : undefined;
  if (previewTab) {
    // A new tab id, so anything kept per tab (responses, batch state) starts fresh.
    const next = makeTab(copy, { preview: true });
    return { ...s, tabs: s.tabs.map((t) => (t.id === previewTab.id ? next : t)), activeId: next.id };
  }
  return insertTab(s, makeTab(copy, { preview }));
}

export function newTab(s: TabsState): TabsState {
  return insertTab(s, makeTab(newRequest()));
}

// ---- Pasted cURL ----

/** Where a pasted command goes: "auto" fills a blank tab or opens a new one; "new" and "active" are the dialog's choices. */
export type CurlTarget = "auto" | "new" | "active";

export interface CurlPlan {
  /** "fill": a blank tab takes the whole request; "replace": keep the tab's name and scripts; "new": a new tab. */
  mode: "fill" | "replace" | "new";
  /** The tab that changes; empty for a new tab. */
  tabId: string;
}

/** Decides where a pasted command goes. A command never overwrites work in "auto": only a blank, unsaved tab is filled. */
export function curlPlan(s: TabsState, target: CurlTarget, isSaved: (t: RequestTab) => boolean): CurlPlan {
  const active = s.tabs.find((t) => t.id === s.activeId);
  if (target === "active" && active) return { mode: "replace", tabId: active.id };
  if (target === "auto" && active && isBlankRequest(active.def) && !isSaved(active)) return { mode: "fill", tabId: active.id };
  return { mode: "new", tabId: "" };
}

/** The request a plan produces from a parsed command; `base` is the tab's request for "fill" and "replace". */
export function mergeCurl(plan: CurlPlan, base: RequestDef | undefined, parsed: RequestDef): RequestDef {
  if (!base || plan.mode === "new") return parsed;
  if (plan.mode === "fill") return { ...parsed, id: base.id };
  const { method, url, params, headers, bodyMode, body, formBody, auth } = parsed;
  return { ...base, method, url, params, headers, bodyMode, body, formBody, auth };
}

/** Puts `def` (made with mergeCurl) where the plan says. `before` is the old request, or null when a tab was created. */
export function applyCurl(s: TabsState, plan: CurlPlan, def: RequestDef): { state: TabsState; tabId: string; before: RequestDef | null } {
  const old = plan.mode === "new" ? undefined : s.tabs.find((t) => t.id === plan.tabId);
  if (!old) {
    const tab = makeTab(def);
    return { state: insertTab(s, tab), tabId: tab.id, before: null };
  }
  return { state: updateTabDef(s, old.id, () => def), tabId: old.id, before: old.def };
}

/** Removes a tab without keeping it for "reopen closed tab" (undoing an import). */
export function discardTab(s: TabsState, id: string, order?: string[]): TabsState {
  return { ...removeTabs(s, new Set([id]), order), closed: s.closed };
}

/** Makes a preview tab permanent. */
export function promote(s: TabsState, id: string): TabsState {
  const t = s.tabs.find((x) => x.id === id);
  if (!t?.preview) return s;
  return { ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, preview: false } : x)) };
}

/** Changes a tab's working copy. Editing makes a preview tab permanent. */
export function updateTabDef(s: TabsState, id: string, patch: Partial<RequestDef> | ((d: RequestDef) => RequestDef)): TabsState {
  return {
    ...s,
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, preview: false, def: typeof patch === "function" ? patch(t.def) : { ...t.def, ...patch } } : t)),
  };
}

export function updateActiveDef(s: TabsState, patch: Partial<RequestDef> | ((d: RequestDef) => RequestDef)): TabsState {
  return updateTabDef(s, s.activeId, patch);
}

export function activate(s: TabsState, id: string): TabsState {
  return s.tabs.some((t) => t.id === id) ? { ...s, activeId: id } : s;
}

/**
 * Removes tabs. The next active tab is the nearest remaining one to the right in
 * `order` (display order, default: the order of `tabs`), or failing that to the left.
 * Removing every tab leaves one new Untitled tab.
 */
function removeTabs(s: TabsState, ids: Set<string>, order?: string[]): TabsState {
  const removed = s.tabs.filter((t) => ids.has(t.id));
  if (removed.length === 0) return s;
  const tabs = s.tabs.filter((t) => !ids.has(t.id));
  const closed = [...removed.reverse(), ...s.closed].slice(0, MAX_CLOSED);
  if (tabs.length === 0) {
    const fresh = makeTab(newRequest());
    return { tabs: [fresh], activeId: fresh.id, closed };
  }
  let activeId = s.activeId;
  if (ids.has(activeId)) {
    const seq = (order ?? s.tabs.map((t) => t.id)).filter((id) => id === s.activeId || !ids.has(id));
    const at = seq.indexOf(s.activeId);
    activeId = seq[at + 1] ?? seq[at - 1] ?? tabs[0].id;
  }
  return { tabs, activeId, closed };
}

export function closeTab(s: TabsState, id: string, order?: string[]): TabsState {
  return removeTabs(s, new Set([id]), order);
}

/** Closes every unpinned tab except `id` and any `protect` says to keep. */
export function closeOthers(s: TabsState, id: string, protect: (t: RequestTab) => boolean = () => false): TabsState {
  const ids = new Set(s.tabs.filter((t) => t.id !== id && !t.pinned && !protect(t)).map((t) => t.id));
  const next = removeTabs(s, ids);
  return ids.has(s.activeId) ? { ...next, activeId: id } : next;
}

/** Closes unpinned tabs `isDirty` says have nothing unsaved. */
export function closeSaved(s: TabsState, isDirty: (t: RequestTab) => boolean, order?: string[]): TabsState {
  return removeTabs(s, new Set(s.tabs.filter((t) => !t.pinned && !isDirty(t)).map((t) => t.id)), order);
}

/** Reopens the most recently closed tab (or the closed tab with this tab id) at the end. */
export function reopenClosed(s: TabsState, tabId?: string): TabsState {
  const at = tabId === undefined ? 0 : s.closed.findIndex((t) => t.id === tabId);
  const tab = s.closed[at];
  if (!tab) return s;
  const rest = s.closed.filter((_, i) => i !== at);
  const reopened = s.tabs.some((t) => t.def.id === tab.def.id) ? null : { ...tab, preview: false };
  if (!reopened) return { ...s, closed: rest, activeId: s.tabs.find((t) => t.def.id === tab.def.id)!.id };
  const tabs = reopened.pinned ? insertPinned(s.tabs, reopened) : [...s.tabs, reopened];
  return { tabs, activeId: reopened.id, closed: rest };
}

function insertPinned(tabs: RequestTab[], tab: RequestTab): RequestTab[] {
  const at = tabs.filter((t) => t.pinned).length;
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
}

export function pin(s: TabsState, id: string): TabsState {
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab || tab.pinned) return s;
  const rest = s.tabs.filter((t) => t.id !== id);
  // Pinning also makes it permanent: it is something to keep.
  return { ...s, tabs: insertPinned(rest, { ...tab, pinned: true, preview: false }) };
}

export function unpin(s: TabsState, id: string): TabsState {
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab || !tab.pinned) return s;
  const rest = s.tabs.filter((t) => t.id !== id);
  // Back to the front of the unpinned tabs, right after the remaining pinned ones.
  return { ...s, tabs: insertPinned(rest, { ...tab, pinned: false }) };
}

export function duplicateTab(s: TabsState, id: string): TabsState {
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return s;
  const src = s.tabs[i].def;
  const copy = makeTab({ ...structuredClone(src), id: newId(), name: `${src.name} copy` });
  return { ...s, tabs: [...s.tabs.slice(0, i + 1), copy, ...s.tabs.slice(i + 1)], activeId: copy.id };
}

/** Next (+1) or previous (-1) tab in `order`, wrapping around. */
export function stepTab(s: TabsState, order: string[], by: 1 | -1): TabsState {
  if (order.length === 0) return s;
  const at = order.indexOf(s.activeId);
  return activate(s, order[(at + by + order.length) % order.length]);
}

/** Tab n (1 to 9; 9 is the last tab) in `order`. */
export function goToTab(s: TabsState, order: string[], n: number): TabsState {
  const id = n >= 9 ? order[order.length - 1] : order[n - 1];
  return id ? activate(s, id) : s;
}

// ---- Groups ----

export interface TabGroup {
  key: string;
  label: string;
  tone: GroupTone;
  tabs: RequestTab[];
}

function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h;
}

export function groupTone(key: string): GroupTone {
  return key === UNSAVED_KEY ? "neutral" : TONES[hashKey(key) % TONES.length];
}

/** Pinned tabs, then the rest grouped by the folder (or collection) that directly holds the saved request. */
export function groupTabs(tabs: RequestTab[], collections: Collection[]): { pinned: RequestTab[]; groups: TabGroup[] } {
  const pinned = tabs.filter((t) => t.pinned);
  const order: string[] = [];
  const byKey = new Map<string, { label: string; collection: string; folder: boolean; tabs: RequestTab[] }>();
  for (const tab of tabs) {
    if (tab.pinned) continue;
    const found = locate(collections, tab.def.id);
    let key = UNSAVED_KEY;
    let label = "Unsaved";
    let collection = "";
    let folder = false;
    if (found && (found.kind === "request" || found.kind === "example")) {
      const dir = found.path[found.path.length - 1];
      key = dir ? dir.id : found.collection.id;
      label = dir ? dir.name : found.collection.name;
      collection = found.collection.name;
      folder = !!dir;
    }
    let g = byKey.get(key);
    if (!g) {
      g = { label, collection, folder, tabs: [] };
      byKey.set(key, g);
      order.push(key);
    }
    g.tabs.push(tab);
  }
  const labelCount = new Map<string, number>();
  for (const g of byKey.values()) labelCount.set(g.label, (labelCount.get(g.label) ?? 0) + 1);
  const keys = [...order.filter((k) => k !== UNSAVED_KEY), ...order.filter((k) => k === UNSAVED_KEY)];
  const groups = keys.map((key) => {
    const g = byKey.get(key)!;
    const clash = (labelCount.get(g.label) ?? 0) > 1 && g.folder;
    return { key, label: clash ? `${g.label} · ${g.collection}` : g.label, tone: groupTone(key), tabs: g.tabs };
  });
  return { pinned, groups };
}

/** Tab ids in the order the bar shows them: pinned first, then group by group. */
export function displayOrder(tabs: RequestTab[], collections: Collection[]): string[] {
  const { pinned, groups } = groupTabs(tabs, collections);
  return [...pinned, ...groups.flatMap((g) => g.tabs)].map((t) => t.id);
}

/** Up to three letters for a pinned tab: initials of the first three words, or the first three letters of a single word. */
export function tabMonogram(name: string, method: string): string {
  const words = name.split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length === 0) return method.toUpperCase();
  const letters = words.length === 1 ? [...words[0]].slice(0, 3) : words.slice(0, 3).map((w) => [...w][0]);
  return letters.join("").toUpperCase();
}

// ---- Unsaved changes ----

function blankRows(rows: { key: string; value: string }[] | undefined): boolean {
  return (rows ?? []).every((r) => r.key === "" && r.value === "");
}

/** True for a request nobody has typed into yet. */
export function isBlankRequest(d: RequestDef): boolean {
  return (
    d.name === "Untitled request" &&
    d.method === "GET" &&
    d.url === "" &&
    d.body === "" &&
    d.bodyMode === "none" &&
    d.auth.type === "none" &&
    blankRows(d.params) &&
    blankRows(d.headers) &&
    blankRows(d.formBody) &&
    !d.preScript &&
    !d.postScript
  );
}

/** The saved version of a tab's request or example, if it is saved. */
export function savedVersionOf(def: RequestDef, collections: Collection[]): RequestDef | undefined {
  const found = locate(collections, def.id);
  return found?.kind === "request" ? found.node.request : found?.kind === "example" ? found.example.request : undefined;
}

/** Unsaved changes: differs from the saved version, or is not saved and has something in it. */
export function isTabDirty(tab: RequestTab, collections: Collection[]): boolean {
  const saved = savedVersionOf(tab.def, collections);
  return saved ? JSON.stringify(saved) !== JSON.stringify(tab.def) : !isBlankRequest(tab.def);
}

// ---- Storage ----

export interface StoredTabs {
  v: number;
  activeId: string;
  tabs: { id: string; def: RequestDef; pinned: boolean; preview: boolean }[];
}

export function serializeTabs(s: TabsState): StoredTabs {
  return { v: TABS_VERSION, activeId: s.activeId, tabs: s.tabs.map((t) => ({ id: t.id, def: t.def, pinned: t.pinned, preview: t.preview })) };
}

/**
 * Reads `rest-runner.tabs` (raw JSON text, or null). When it is missing, the old single
 * draft (`rest-runner.draft`, already parsed) becomes the one tab. Bad data gives one new tab.
 */
export function loadTabs(raw: string | null, legacyDraft: unknown): TabsState {
  if (raw === null || raw === undefined) {
    const draft = isRequestDef(legacyDraft) ? completeRequest(legacyDraft) : null;
    return draft ? initialTabs(draft) : initialTabs();
  }
  try {
    const data = JSON.parse(raw) as Partial<StoredTabs> | null;
    if (!data || data.v !== TABS_VERSION || !Array.isArray(data.tabs)) return initialTabs();
    const seen = new Set<string>();
    const tabs: RequestTab[] = [];
    for (const t of data.tabs) {
      // A def that passes the basic check can still miss newer parts (auth, form body): fill them in.
      const def = t && isRequestDef(t.def) ? completeRequest(t.def) : null;
      if (!t || typeof t.id !== "string" || !def || seen.has(t.id)) return initialTabs();
      seen.add(t.id);
      tabs.push({ id: t.id, def, pinned: t.pinned === true, preview: t.preview === true });
    }
    if (tabs.length === 0) return initialTabs();
    // Pinned tabs keep to the front, and only one preview survives.
    const sorted = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
    let previewSeen = false;
    const clean = sorted.map((t) => {
      if (!t.preview) return t;
      if (previewSeen || t.pinned) return { ...t, preview: false };
      previewSeen = true;
      return t;
    });
    const activeId = typeof data.activeId === "string" && seen.has(data.activeId) ? data.activeId : clean[0].id;
    return { tabs: clean, activeId, closed: [] };
  } catch {
    return initialTabs();
  }
}

// ---- Shortcuts ----

export type TabShortcut =
  | { type: "new" }
  | { type: "close" }
  | { type: "reopen" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; n: number };

interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Which tab command a key press is, by physical key (so it works on any keyboard layout), or null. */
export function tabShortcut(e: KeyLike): TabShortcut | null {
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === "Tab") {
    if (!e.ctrlKey || e.metaKey || e.altKey) return null;
    return { type: e.shiftKey ? "prev" : "next" };
  }
  if (!mod) return null;
  if (e.code === "KeyT" && !e.altKey) return { type: e.shiftKey ? "reopen" : "new" };
  if (e.code === "KeyW" && !e.altKey && !e.shiftKey) return { type: "close" };
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m && e.altKey && !e.shiftKey) return { type: "goto", n: Number(m[1]) };
  return null;
}
