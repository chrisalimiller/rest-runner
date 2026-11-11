import { useCallback, useEffect, useRef, useState } from "react";
import { guardLeave } from "./lib/unsavedWork";
import App from "./App";
import { QuickOpen } from "./components/shell/QuickOpen";
import type { Mode } from "./components/shell/TopBar";
import { FlowsApp } from "./components/flows/FlowsApp";
import { ToolsApp } from "./components/tools/ToolsApp";
import { TestingApp } from "./components/testing/TestingApp";
import { type QuickItem } from "./lib/quickOpen";
import { buildCommands, type CommandActions, type CommandCtx, type RequestsAction } from "./lib/commands";
import { ShortcutsDialog } from "./components/shell/ShortcutsDialog";
import { loadEnvironments } from "./lib/environments";
import { getThemePref, setThemePref } from "./lib/theme";
import { toggleSidePanel, openSidePanel } from "./lib/sidePanels";
import { isEditableTarget, matchesShortcut } from "./lib/shortcuts";
import { CertificatesDialog } from "./components/CertificatesDialog";
import { ImportDialog } from "./components/ImportDialog";
import { closeImportDialog, openImportDialog, useImportDialog } from "./lib/importDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import {
  closeUpdateDialog,
  openUpdateDialog,
  useUpdateDialog,
} from "./lib/updateDialog";
import {
  closeCertificates,
  useCertificatesDialog,
} from "./lib/certificatesDialog";
import { CertificatesPanel } from "./components/CertificatesPanel";
import { SidePanelSlotContext } from "./components/shell/SidePanelSlot";
import { SideRail } from "./components/shell/SideRail";
import { FirstRun } from "./components/shell/FirstRun";
import { modeForShortcut } from "./lib/topBar";
import { markSectionSeen, useSectionStatus } from "./lib/sectionStatus";
import { isString, load, save } from "./lib/storage";
import { isFirstRun } from "./lib/workspaceStore";

const SECTION_KEY = "rest-runner.section";

/** Something quick open asked a mode to do. The nonce makes the same pick twice count twice. */
export type ShellCommand =
  | { type: "open"; item: QuickItem; nonce: number; permanent?: boolean }
  | { type: "clear-history"; nonce: number }
  /** The palette's "New tool" command. */
  | { type: "new-tool"; nonce: number }
  /** Another mode changed saved data this mode keeps in memory: read it again from storage. */
  | { type: "reload"; nonce: number }
  /** Another mode's Variables panel asked for the environment editor, which only Requests has. */
  | { type: "edit-environments"; nonce: number; varId?: string }
  /** A palette command for Requests (send, new request, switch environment and so on). */
  | { type: "action"; nonce: number; action: RequestsAction };

function modeFor(item: QuickItem): Mode {
  if (item.kind === "flow" || item.kind === "flow-run") return "flows";
  if (item.kind === "tool") return "tools";
  if (item.kind === "command") return "requests";
  return item.kind === "suite" ||
    item.kind === "case" ||
    item.kind === "test-run"
    ? "testing"
    : "requests";
}

/** The four modes (Requests, Testing, Flows and Tools). All stay mounted so a running batch, suite or flow keeps going. */
export default function Root() {
  const [section, setSectionNow] = useState<Mode>(() => {
    const saved = load<string>(SECTION_KEY, "requests");
    return saved === "testing" || saved === "flows" || saved === "tools" ? saved : "requests";
  });
  // Leaving a section with unsaved edits (a tool being built) asks first.
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const setSection = useCallback((next: Mode) => {
    const from = sectionRef.current;
    if (next !== from) guardLeave(from, () => setSectionNow(next));
  }, []);
  const [quickOpen, setQuickOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const certificates = useCertificatesDialog();
  const updateOpen = useUpdateDialog();
  const importOpen = useImportDialog();
  const [firstRun, setFirstRun] = useState(() => isFirstRun());
  const [commands, setCommands] = useState<Record<Mode, ShellCommand | null>>({
    requests: null,
    testing: null,
    flows: null,
    tools: null,
  });
  useEffect(() => {
    save(SECTION_KEY, section);
  }, [section]);
  // Opening Testing or Flows counts as looking at its latest run, so the rail's failure badge goes away.
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const status = useSectionStatus();
  useEffect(() => {
    if (section === "testing" && status.testing.unseen)
      markSectionSeen("testing");
    if (section === "flows" && status.flows.unseen) markSectionSeen("flows");
    if (section === "tools" && status.tools.unseen) markSectionSeen("tools");
  }, [section, status.testing.unseen, status.flows.unseen, status.tools.unseen]);

  const quickOpenRef = useRef(false);
  quickOpenRef.current = quickOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut("quick-open", e)) {
        e.preventDefault();
        setQuickOpen((o) => !o);
        return;
      }
      // "?" opens the shortcut list, unless a field has focus (it would type one) or another dialog is up.
      if (matchesShortcut("keyboard-shortcuts", e) && !quickOpenRef.current && !isEditableTarget(e.target) && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // Mod + 1/2/3 switch sections, even from a text field (nothing types with Mod held). Not while Quick open is up.
      const next = quickOpenRef.current ? null : modeForShortcut(e);
      if (next) {
        e.preventDefault();
        setSection(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The macOS menu item "Check for Updates…" asks the page to open the same dialog.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    let gone = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("open-update-dialog", () => openUpdateDialog()).then((un) => {
        if (gone) un();
        else unlisten = un;
      }),
    );
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  const send = (mode: Mode, cmd: ShellCommand) =>
    setCommands((c) => ({ ...c, [mode]: cmd }));
  const commandActions: CommandActions = {
    setSection,
    requests: (action) => {
      // Setting the environment works from any section; the rest are Requests work.
      if (action.type !== "set-environment") setSection("requests");
      send("requests", { type: "action", nonce: Date.now(), action });
    },
    newTool: () => {
      setSection("tools");
      send("tools", { type: "new-tool", nonce: Date.now() });
    },
    toggleVariables: () => toggleSidePanel("variables"),
    openCertificates: () => openSidePanel("certificates"),
    openAbout: openUpdateDialog,
    openImport: openImportDialog,
    openShortcuts: () => setShortcutsOpen(true),
    setTheme: setThemePref,
  };
  const shell: ShellProps = {
    section,
    onQuickOpen: () => setQuickOpen(true),
    onEditEnvironments: (varId) => {
      setSection("requests");
      send("requests", { type: "edit-environments", nonce: Date.now(), varId });
    },
    onOpenRequest: (id) => {
      setSection("requests");
      send("requests", { type: "open", item: { kind: "request", id, title: "", detail: "" }, nonce: Date.now(), permanent: true });
    },
    onDataChanged: (what) => {
      const nonce = Date.now();
      if (what.includes("collections"))
        send("requests", { type: "reload", nonce });
      if (what.includes("suites")) send("testing", { type: "reload", nonce });
      if (what.includes("flows")) send("flows", { type: "reload", nonce });
      if (what.includes("tools")) send("tools", { type: "reload", nonce });
    },
  };

  /** The palette's registry and what it runs against, read fresh each time it opens. */
  const paletteProps = () => {
    const base = {
      environments: loadEnvironments().map((e) => ({ id: e.id, name: e.name })),
      activeEnvId: load<string | null>("rest-runner.active-environment", null, isString),
      theme: getThemePref(),
    };
    const ctx: CommandCtx = { section, ...base, actions: commandActions };
    return { commands: buildCommands(base), ctx };
  };

  return (
    <SidePanelSlotContext.Provider value={panelSlot}>
      <div className="app-shell">
        <div className="root-sections">
          <div className="root-section" hidden={section !== "requests"}>
            <App
              active={section === "requests" && !quickOpen}
              shell={shell}
              command={commands.requests}
            />
          </div>
          <div className="root-section" hidden={section !== "testing"}>
            <TestingApp
              active={section === "testing"}
              shell={shell}
              command={commands.testing}
            />
          </div>
          <div className="root-section" hidden={section !== "flows"}>
            <FlowsApp
              active={section === "flows"}
              shell={shell}
              command={commands.flows}
            />
          </div>
          <div className="root-section" hidden={section !== "tools"}>
            <ToolsApp
              active={section === "tools"}
              shell={shell}
              command={commands.tools}
            />
          </div>
        </div>
        <div className="side-panel-slot" ref={setPanelSlot} />
        <CertificatesPanel section={section} />
        <SideRail section={section} onMode={setSection} />
        {firstRun && (
          <FirstRun
            onDone={(changed) => {
              setFirstRun(false);
              if (changed)
                shell.onDataChanged(["collections", "suites", "flows", "tools"]);
            }}
          />
        )}
        {certificates.open && (
          <CertificatesDialog
            entryId={certificates.entryId}
            onClose={closeCertificates}
          />
        )}
        {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
        {updateOpen && <UpdateDialog onClose={closeUpdateDialog} />}
        {importOpen && <ImportDialog onClose={closeImportDialog} onChanged={() => shell.onDataChanged(["collections", "suites", "flows", "tools"])} />}
        {quickOpen && (
          <QuickOpen
            mode={section}
            {...paletteProps()}
            onClose={() => setQuickOpen(false)}
            onPick={(item, permanent) => {
              setQuickOpen(false);
              const mode = modeFor(item);
              setSection(mode);
              send(mode, { type: "open", item, nonce: Date.now(), permanent });
            }}
            onClearHistory={() =>
              send("requests", { type: "clear-history", nonce: Date.now() })
            }
          />
        )}
      </div>
    </SidePanelSlotContext.Provider>
  );
}

export interface ShellProps {
  /** The section on screen. */
  section: Mode;
  /** Opens the environment editor in Requests, on the variable `varId` when given. */
  onEditEnvironments: (varId?: string) => void;
  onQuickOpen: () => void;
  /** Switches to Requests with this saved request open (Tools: "Open request"). */
  onOpenRequest: (id: string) => void;
  /** A mode wrote saved data that another mode holds in memory (Flows importing suites or requests). */
  onDataChanged: (what: ("suites" | "collections" | "flows" | "tools")[]) => void;
}
