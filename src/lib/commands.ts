import type { Mode } from "../components/shell/TopBar";
import type { ThemePref } from "./theme";
import { CURL_COMMAND_ID, IMPORT_COMMAND_ID, UPDATES_COMMAND_ID, type QuickItem } from "./quickOpen";
import { shortcutKeys } from "./shortcuts";

/**
 * The command registry behind the command palette (Ctrl/Cmd + K). A command is plain data plus
 * `enabled` and `run`. Filtering and ranking are pure and live in quickOpen.ts (searchQuickOpen).
 *
 * To add a command: add an entry in `buildCommands`, or have the feature build its own `Command`
 * and append it to the list Root passes to the palette. Give it a `shortcut` only if the key really
 * exists, and add that key to shortcuts.ts first.
 */

export type CommandGroup = "Go to" | "Request" | "Environment" | "View" | "App";

/** Things a command asks the app to do. Root implements these; tests pass fakes. */
export interface CommandActions {
  setSection: (mode: Mode) => void;
  /** Requests-section work. */
  requests: (action: RequestsAction) => void;
  /** Switches to Tools and starts a new tool. */
  newTool: () => void;
  toggleVariables: () => void;
  openCertificates: () => void;
  openAbout: () => void;
  openImport: () => void;
  openShortcuts: () => void;
  setTheme: (pref: ThemePref) => void;
}

export type RequestsAction =
  | { type: "send" }
  | { type: "open-batch" }
  | { type: "new-request" }
  | { type: "new-collection" }
  | { type: "export-workspace" }
  | { type: "import-curl" }
  | { type: "set-environment"; id: string | null };

export interface CommandCtx {
  section: Mode;
  environments: { id: string; name: string }[];
  activeEnvId: string | null;
  theme: ThemePref;
  actions: CommandActions;
}

/** What `run` may return: keep the palette open with this text typed in (a "submenu"). */
export type CommandResult = { query: string } | void;

export interface Command {
  id: string;
  title: string;
  /** Extra words that find it, space separated. */
  keywords: string;
  /** Keys shown at the right, e.g. "Mod+Enter". Use `shortcutKeys` so it matches shortcuts.ts. */
  shortcut?: string;
  group: CommandGroup;
  /** Shown muted after the title ("Current", ...). */
  detail?: string;
  enabled: (ctx: CommandCtx) => boolean;
  run: (ctx: CommandCtx) => CommandResult;
}

export { CURL_COMMAND_ID, IMPORT_COMMAND_ID, UPDATES_COMMAND_ID };
export const SHORTCUTS_COMMAND_ID = "keyboard-shortcuts";
/** Typed into the palette by "Switch environment…" so the environments are listed. */
export const ENV_MENU_QUERY = ">Environment: ";

const always = () => true;
const inRequests = (ctx: CommandCtx) => ctx.section === "requests";

const THEME_LABELS: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

export function buildCommands(ctx: Pick<CommandCtx, "environments" | "activeEnvId" | "theme">): Command[] {
  const section = (id: string, mode: Mode, title: string): Command => ({
    id,
    title,
    keywords: `switch go section mode ${mode}`,
    shortcut: shortcutKeys(`section-${mode}`),
    group: "Go to",
    enabled: (c) => c.section !== mode,
    run: (c) => c.actions.setSection(mode),
  });

  const activeKnown = ctx.environments.some((e) => e.id === ctx.activeEnvId);
  const envs: { id: string | null; name: string }[] = ctx.environments.length
    ? [{ id: null, name: "None" }, ...ctx.environments.map((e) => ({ id: e.id, name: e.name || "(unnamed)" }))]
    : [];

  return [
    section("go-requests", "requests", "Go to Requests"),
    section("go-testing", "testing", "Go to Testing"),
    section("go-flows", "flows", "Go to Flows"),
    section("go-tools", "tools", "Go to Tools"),
    { id: "send", title: "Send request", keywords: "run request send", shortcut: shortcutKeys("send"), group: "Request", enabled: inRequests, run: (c) => c.actions.requests({ type: "send" }) },
    { id: "run-csv", title: "Run with CSV…", keywords: "batch csv rows data run", group: "Request", enabled: inRequests, run: (c) => c.actions.requests({ type: "open-batch" }) },
    { id: "new-request", title: "New request", keywords: "new tab untitled create request", shortcut: shortcutKeys("new-request"), group: "Request", enabled: inRequests, run: (c) => c.actions.requests({ type: "new-request" }) },
    { id: "new-collection", title: "New collection", keywords: "new create collection folder", group: "Request", enabled: always, run: (c) => c.actions.requests({ type: "new-collection" }) },
    { id: IMPORT_COMMAND_ID, title: "Import…", keywords: "import postman insomnia bruno env dotenv file collection environment open drop", group: "Request", enabled: always, run: (c) => c.actions.openImport() },
    { id: "new-tool", title: "New tool", keywords: "new create tool lookup page", group: "Request", enabled: always, run: (c) => c.actions.newTool() },
    { id: CURL_COMMAND_ID, title: "Import from cURL…", keywords: "curl paste import command", group: "Request", enabled: always, run: (c) => c.actions.requests({ type: "import-curl" }) },
    { id: "export-workspace", title: "Export workspace…", keywords: "export save backup download file", group: "Request", enabled: always, run: (c) => c.actions.requests({ type: "export-workspace" }) },
    ...(envs.length > 0
      ? [{ id: "switch-environment", title: "Switch environment…", keywords: "env environment change pick", group: "Environment", enabled: always, run: () => ({ query: ENV_MENU_QUERY }) } satisfies Command]
      : []),
    ...envs.map(
      (e): Command => ({
        id: `env:${e.id ?? "none"}`,
        title: `Environment: ${e.name}`,
        keywords: "env environment switch",
        group: "Environment",
        detail: e.id === ctx.activeEnvId || (e.id === null && !activeKnown) ? "Current" : undefined,
        enabled: always,
        run: (c) => c.actions.requests({ type: "set-environment", id: e.id }),
      }),
    ),
    { id: "toggle-variables", title: "Toggle Variables panel", keywords: "variables panel side sidebar vars", group: "View", enabled: always, run: (c) => c.actions.toggleVariables() },
    { id: "open-certificates", title: "Open Certificates", keywords: "certificates tls mtls client cert panel", group: "View", enabled: always, run: (c) => c.actions.openCertificates() },
    ...(["system", "light", "dark"] as ThemePref[]).map(
      (pref): Command => ({
        id: `theme:${pref}`,
        title: `Appearance: ${THEME_LABELS[pref]}`,
        keywords: "appearance theme dark light system color mode",
        group: "View",
        detail: ctx.theme === pref ? "Current" : undefined,
        enabled: always,
        run: (c) => c.actions.setTheme(pref),
      }),
    ),
    { id: SHORTCUTS_COMMAND_ID, title: "Keyboard shortcuts", keywords: "keys hotkeys help cheat sheet shortcuts", shortcut: shortcutKeys("keyboard-shortcuts"), group: "App", enabled: always, run: (c) => c.actions.openShortcuts() },
    { id: UPDATES_COMMAND_ID, title: "Settings and about…", keywords: "settings preferences about update upgrade version release check for updates", group: "App", enabled: always, run: (c) => c.actions.openAbout() },
  ];
}

/** Palette rows for the enabled commands, in registry order. The item `id` is the command id. */
export function commandItems(commands: Command[], ctx: CommandCtx): QuickItem[] {
  return commands
    .filter((c) => c.enabled(ctx))
    .map((c) => ({ kind: "command" as const, id: c.id, title: c.title, detail: c.detail ?? "", keywords: c.keywords, shortcut: c.shortcut }));
}
