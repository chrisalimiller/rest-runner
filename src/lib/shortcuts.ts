/**
 * Keyboard shortcuts as data, for the command palette's right-hand keys and the Keyboard shortcuts dialog.
 *
 * The handlers for quick-open, "?", send, save and rename call `matchesShortcut(id, event)`, so those keys
 * come from this registry. The rest (Mod + 1/2/3 in Root.tsx via modeForShortcut, tabs in requestTabs.ts,
 * editor keys in CodeMirror) are still matched where they live, so changing one means changing it here
 * too, and in docs/shortcuts.md. shortcuts.test.ts checks the registry is well formed and that the
 * matcher agrees with every simple entry.
 */

export type ShortcutGroup = "General" | "Requests" | "Tabs" | "Editors";

export interface Shortcut {
  /** Stable id; a palette command with the same id shows these keys. */
  id: string;
  /** Keys joined with "+": Mod (Ctrl, or Cmd on a Mac), Ctrl, Alt, Shift, then a key name. */
  keys: string;
  label: string;
  group: ShortcutGroup;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = ["General", "Requests", "Tabs", "Editors"];

export const SHORTCUTS: Shortcut[] = [
  { id: "quick-open", keys: "Mod+K", label: "Open or close the command palette", group: "General" },
  { id: "section-requests", keys: "Mod+1", label: "Switch to Requests", group: "General" },
  { id: "section-testing", keys: "Mod+2", label: "Switch to Testing", group: "General" },
  { id: "section-flows", keys: "Mod+3", label: "Switch to Flows", group: "General" },
  { id: "keyboard-shortcuts", keys: "?", label: "Show keyboard shortcuts (when no field is focused)", group: "General" },
  { id: "close", keys: "Esc", label: "Close the palette, menus and dialogs", group: "General" },
  { id: "send", keys: "Mod+Enter", label: "Send the request", group: "Requests" },
  { id: "save", keys: "Mod+S", label: "Save the open request or example", group: "Requests" },
  { id: "rename", keys: "F2", label: "Rename the open request", group: "Requests" },
  { id: "new-request", keys: "Mod+T", label: "New tab (an Untitled request)", group: "Tabs" },
  { id: "close-tab", keys: "Mod+W", label: "Close the active tab", group: "Tabs" },
  { id: "reopen-tab", keys: "Mod+Shift+T", label: "Reopen the last closed tab", group: "Tabs" },
  { id: "next-tab", keys: "Ctrl+Tab", label: "Next tab", group: "Tabs" },
  { id: "prev-tab", keys: "Ctrl+Shift+Tab", label: "Previous tab", group: "Tabs" },
  { id: "goto-tab", keys: "Mod+Alt+1", label: "Go to tab 1 to 8 (9 is the last tab)", group: "Tabs" },
  { id: "format-json", keys: "Shift+Alt+F", label: "Format the JSON body", group: "Editors" },
  { id: "undo", keys: "Mod+Z", label: "Undo (in Flows, outside text fields, the last canvas edit)", group: "Editors" },
  { id: "complete", keys: "Ctrl+Space", label: "Show autocomplete in a script editor", group: "Editors" },
];

export function shortcutKeys(id: string): string | undefined {
  return SHORTCUTS.find((s) => s.id === id)?.keys;
}

export const isMacPlatform = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const MAC_SYMBOLS: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧" };
const PC_NAMES: Record<string, string> = { Mod: "Ctrl" };

/** "Mod+Shift+T" as "⌘ ⇧ T" on a Mac and "Ctrl+Shift+T" elsewhere. */
export function formatKeys(keys: string, mac: boolean): string {
  const parts = keys.split("+").map((p) => (mac ? MAC_SYMBOLS[p] : PC_NAMES[p]) ?? p);
  return parts.join(mac ? " " : "+");
}

/** True when typing would go into the target: a text field, a select or an editor (CodeMirror is contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** Pieces of a Shortcut.keys string: the key and which modifiers it asks for. */
function parseKeys(keys: string) {
  const parts = keys.split("+");
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  return { key, mod: mods.has("Mod"), ctrl: mods.has("Ctrl"), alt: mods.has("Alt"), shift: mods.has("Shift") };
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/**
 * True when the key event is the shortcut with this id. Mod is Ctrl or Cmd; Alt and Shift must match exactly
 * (Shift is ignored for "?", which needs it to type). Letters compare case-insensitively; "Esc" is "Escape".
 */
export function matchesShortcut(id: string, e: KeyEventLike): boolean {
  const keys = shortcutKeys(id);
  if (!keys) return false;
  const want = parseKeys(keys);
  const name = want.key === "Esc" ? "Escape" : want.key;
  if (e.key.length === 1 ? e.key.toLowerCase() !== name.toLowerCase() : e.key !== name) return false;
  if (want.mod ? !(e.metaKey || e.ctrlKey) : want.ctrl ? !e.ctrlKey || e.metaKey : e.metaKey || e.ctrlKey) return false;
  if (e.altKey !== want.alt) return false;
  return name === "?" || e.shiftKey === want.shift;
}
