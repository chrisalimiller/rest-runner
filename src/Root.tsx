import { useEffect, useRef, useState } from "react";
import App from "./App";
import { QuickOpen } from "./components/shell/QuickOpen";
import type { Mode } from "./components/shell/TopBar";
import { FlowsApp } from "./components/flows/FlowsApp";
import { TestingApp } from "./components/testing/TestingApp";
import { UPDATES_COMMAND_ID, type QuickItem } from "./lib/quickOpen";
import { CertificatesDialog } from "./components/CertificatesDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { closeUpdateDialog, openUpdateDialog, useUpdateDialog } from "./lib/updateDialog";
import { closeCertificates, useCertificatesDialog } from "./lib/certificatesDialog";
import { SideRail } from "./components/shell/SideRail";
import { FirstRun } from "./components/shell/FirstRun";
import { modeForShortcut } from "./lib/topBar";
import { markSectionSeen, useSectionStatus } from "./lib/sectionStatus";
import { load, save } from "./lib/storage";
import { isFirstRun } from "./lib/workspaceStore";

const SECTION_KEY = "rest-runner.section";

/** Something quick open asked a mode to do. The nonce makes the same pick twice count twice. */
export type ShellCommand =
  | { type: "open"; item: QuickItem; nonce: number; permanent?: boolean }
  | { type: "clear-history"; nonce: number }
  /** Another mode changed saved data this mode keeps in memory: read it again from storage. */
  | { type: "reload"; nonce: number };

function modeFor(item: QuickItem): Mode {
  if (item.kind === "flow" || item.kind === "flow-run") return "flows";
  if (item.kind === "command") return "requests";
  return item.kind === "suite" || item.kind === "case" || item.kind === "test-run" ? "testing" : "requests";
}

/** The three modes (Requests, Testing and Flows). All stay mounted so a running batch, suite or flow keeps going. */
export default function Root() {
  const [section, setSection] = useState<Mode>(() => {
    const saved = load<string>(SECTION_KEY, "requests");
    return saved === "testing" || saved === "flows" ? saved : "requests";
  });
  const [quickOpen, setQuickOpen] = useState(false);
  const certificates = useCertificatesDialog();
  const updateOpen = useUpdateDialog();
  const [firstRun, setFirstRun] = useState(() => isFirstRun());
  const [commands, setCommands] = useState<Record<Mode, ShellCommand | null>>({ requests: null, testing: null, flows: null });
  useEffect(() => {
    save(SECTION_KEY, section);
  }, [section]);
  // Opening Testing or Flows counts as looking at its latest run, so the rail's failure badge goes away.
  const status = useSectionStatus();
  useEffect(() => {
    if (section === "testing" && status.testing.unseen) markSectionSeen("testing");
    if (section === "flows" && status.flows.unseen) markSectionSeen("flows");
  }, [section, status.testing.unseen, status.flows.unseen]);

  const quickOpenRef = useRef(false);
  quickOpenRef.current = quickOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setQuickOpen((o) => !o);
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

  const send = (mode: Mode, cmd: ShellCommand) => setCommands((c) => ({ ...c, [mode]: cmd }));
  const shell: ShellProps = {
    onQuickOpen: () => setQuickOpen(true),
    onDataChanged: (what) => {
      const nonce = Date.now();
      if (what.includes("collections")) send("requests", { type: "reload", nonce });
      if (what.includes("suites")) send("testing", { type: "reload", nonce });
      if (what.includes("flows")) send("flows", { type: "reload", nonce });
    },
  };

  return (
    <div className="app-shell">
      <div className="root-sections">
        <div className="root-section" hidden={section !== "requests"}>
          <App active={section === "requests" && !quickOpen} shell={shell} command={commands.requests} />
        </div>
        <div className="root-section" hidden={section !== "testing"}>
          <TestingApp active={section === "testing"} shell={shell} command={commands.testing} />
        </div>
        <div className="root-section" hidden={section !== "flows"}>
          <FlowsApp active={section === "flows"} shell={shell} command={commands.flows} />
        </div>
      </div>
      <SideRail section={section} onMode={setSection} />
      {firstRun && (
        <FirstRun
          onDone={(changed) => {
            setFirstRun(false);
            if (changed) shell.onDataChanged(["collections", "suites", "flows"]);
          }}
        />
      )}
      {certificates.open && <CertificatesDialog entryId={certificates.entryId} onClose={closeCertificates} />}
      {updateOpen && <UpdateDialog onClose={closeUpdateDialog} />}
      {quickOpen && (
        <QuickOpen
          mode={section}
          onClose={() => setQuickOpen(false)}
          onPick={(item, permanent) => {
            setQuickOpen(false);
            if (item.kind === "command" && item.id === UPDATES_COMMAND_ID) {
              openUpdateDialog();
              return;
            }
            const mode = modeFor(item);
            setSection(mode);
            send(mode, { type: "open", item, nonce: Date.now(), permanent });
          }}
          onClearHistory={() => send("requests", { type: "clear-history", nonce: Date.now() })}
        />
      )}
    </div>
  );
}

export interface ShellProps {
  onQuickOpen: () => void;
  /** A mode wrote saved data that another mode holds in memory (Flows importing suites or requests). */
  onDataChanged: (what: ("suites" | "collections" | "flows")[]) => void;
}
