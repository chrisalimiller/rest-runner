import { describe, expect, it, vi } from "vitest";
import { buildCommands, commandItems, ENV_MENU_QUERY, type CommandActions, type CommandCtx } from "./commands";
import { formatKeys, shortcutKeys, SHORTCUTS } from "./shortcuts";

function makeCtx(over: Partial<CommandCtx> = {}) {
  const actions: CommandActions = {
    setSection: vi.fn(),
    requests: vi.fn(),
    newTool: vi.fn(),
    toggleVariables: vi.fn(),
    openCertificates: vi.fn(),
    openAbout: vi.fn(),
    openShortcuts: vi.fn(),
    setTheme: vi.fn(),
  };
  const ctx: CommandCtx = { section: "requests", environments: [{ id: "e1", name: "Staging" }, { id: "e2", name: "" }], activeEnvId: "e1", theme: "dark", actions, ...over };
  return { ctx, actions, commands: buildCommands(ctx) };
}

describe("command registry", () => {
  it("has unique ids and only shows keys that exist in the shortcut map", () => {
    const { commands } = makeCtx();
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
    const known = new Set(SHORTCUTS.map((s) => s.keys));
    for (const c of commands) if (c.shortcut) expect(known.has(c.shortcut)).toBe(true);
  });

  it("hides the section you are in and Requests-only commands elsewhere", () => {
    const req = makeCtx();
    const ids = (m: ReturnType<typeof makeCtx>) => commandItems(m.commands, m.ctx).map((i) => i.id);
    expect(ids(req)).not.toContain("go-requests");
    expect(ids(req)).toContain("send");
    const testing = makeCtx({ section: "testing" });
    expect(ids(testing)).toContain("go-requests");
    expect(ids(testing)).not.toContain("send");
    expect(ids(testing)).not.toContain("run-csv");
  });

  it("lists None and each environment, marks the current one, and has no submenu without environments", () => {
    const { ctx, commands } = makeCtx();
    const envs = commandItems(commands, ctx).filter((i) => i.id.startsWith("env:"));
    expect(envs.map((i) => [i.title, i.detail])).toEqual([
      ["Environment: None", ""],
      ["Environment: Staging", "Current"],
      ["Environment: (unnamed)", ""],
    ]);
    const none = makeCtx({ environments: [], activeEnvId: null });
    expect(none.commands.some((c) => c.id.startsWith("env:") || c.id === "switch-environment")).toBe(false);
  });

  it("runs: the environment submenu returns a query, the others call their action", () => {
    const { ctx, actions, commands } = makeCtx();
    const by = (id: string) => commands.find((c) => c.id === id)!;
    expect(by("switch-environment").run(ctx)).toEqual({ query: ENV_MENU_QUERY });
    by("env:e1").run(ctx);
    expect(actions.requests).toHaveBeenCalledWith({ type: "set-environment", id: "e1" });
    by("env:none").run(ctx);
    expect(actions.requests).toHaveBeenCalledWith({ type: "set-environment", id: null });
    by("theme:light").run(ctx);
    expect(actions.setTheme).toHaveBeenCalledWith("light");
    by("go-flows").run(ctx);
    expect(actions.setSection).toHaveBeenCalledWith("flows");
    by("toggle-variables").run(ctx);
    expect(actions.toggleVariables).toHaveBeenCalled();
    by("keyboard-shortcuts").run(ctx);
    expect(actions.openShortcuts).toHaveBeenCalled();
  });
});

describe("shortcuts", () => {
  it("formats keys for Mac and other platforms", () => {
    expect(formatKeys("Mod+Shift+T", true)).toBe("⌘ ⇧ T");
    expect(formatKeys("Mod+Shift+T", false)).toBe("Ctrl+Shift+T");
    expect(formatKeys("Ctrl+Tab", true)).toBe("Ctrl Tab");
    expect(shortcutKeys("send")).toBe("Mod+Enter");
    expect(shortcutKeys("nope")).toBeUndefined();
  });

  it("has unique ids", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });
});
