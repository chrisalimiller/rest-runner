import { useEffect, useState } from "react";
import App from "./App";
import { QuickOpen } from "./components/shell/QuickOpen";
import type { Mode } from "./components/shell/TopBar";
import { TestingApp } from "./components/testing/TestingApp";
import type { QuickItem } from "./lib/quickOpen";
import { load, save } from "./lib/storage";

const SECTION_KEY = "rest-runner.section";

/** Something quick open asked a mode to do. The nonce makes the same pick twice count twice. */
export type ShellCommand = { type: "open"; item: QuickItem; nonce: number } | { type: "clear-history"; nonce: number };

function modeFor(item: QuickItem): Mode {
  return item.kind === "suite" || item.kind === "case" || item.kind === "test-run" ? "testing" : "requests";
}

/** The two modes (Requests and Testing). Both stay mounted so a running batch or suite keeps going. */
export default function Root() {
  const [section, setSection] = useState<Mode>(() => (load<string>(SECTION_KEY, "requests") === "testing" ? "testing" : "requests"));
  const [quickOpen, setQuickOpen] = useState(false);
  const [commands, setCommands] = useState<Record<Mode, ShellCommand | null>>({ requests: null, testing: null });
  useEffect(() => {
    save(SECTION_KEY, section);
  }, [section]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setQuickOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = (mode: Mode, cmd: ShellCommand) => setCommands((c) => ({ ...c, [mode]: cmd }));
  const shell = { onMode: setSection, onQuickOpen: () => setQuickOpen(true) };

  return (
    <div className="app-shell">
      <div className="root-section" hidden={section !== "requests"}>
        <App active={section === "requests" && !quickOpen} shell={shell} command={commands.requests} />
      </div>
      <div className="root-section" hidden={section !== "testing"}>
        <TestingApp active={section === "testing"} shell={shell} command={commands.testing} />
      </div>
      {quickOpen && (
        <QuickOpen
          mode={section}
          onClose={() => setQuickOpen(false)}
          onPick={(item) => {
            setQuickOpen(false);
            const mode = modeFor(item);
            setSection(mode);
            send(mode, { type: "open", item, nonce: Date.now() });
          }}
          onClearHistory={() => send("requests", { type: "clear-history", nonce: Date.now() })}
        />
      )}
    </div>
  );
}

export interface ShellProps {
  onMode: (mode: Mode) => void;
  onQuickOpen: () => void;
}
