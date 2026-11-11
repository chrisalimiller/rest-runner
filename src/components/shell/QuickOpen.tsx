import { useEffect, useMemo, useRef, useState } from "react";
import { cleanCollections, migrateSavedRequests, isRequestDef } from "../../lib/collections";
import {
  batchRunItems,
  collectionItems,
  CURL_COMMAND_ID,
  flowItems,
  flowRunItems,
  historyItems,
  KIND_ORDER,
  searchQuickOpen,
  suiteItems,
  testRunItems,
  toolItems,
  type QuickItem,
} from "../../lib/quickOpen";
import { commandItems, type Command, type CommandCtx } from "../../lib/commands";
import { formatKeys, isMacPlatform } from "../../lib/shortcuts";
import { looksLikeCurl } from "../../lib/curlImport";
import { listRuns } from "../../lib/runStore";
import { isArray, load } from "../../lib/storage";
import { cleanHistory } from "../../lib/history";
import { cleanSuites } from "../../lib/testing/suites";
import { listTestRuns } from "../../lib/testing/testRunStore";
import { listFlowRuns } from "../../lib/flows/flowRunStore";
import { loadFlows } from "../../lib/flows/flows";
import { loadTools } from "../../lib/tools/tools";
import { useEscape } from "../useEscape";
import { useExitTransition } from "../useExitTransition";
import { useFocusTrap } from "../useFocusTrap";
import { SearchIcon } from "./Icons";
import type { Mode } from "./TopBar";

interface Props {
  mode: Mode;
  onClose: () => void;
  /** `permanent` (Ctrl/Cmd + Enter) opens a request in a tab of its own instead of the preview tab. */
  onPick: (item: QuickItem, permanent?: boolean) => void;
  onClearHistory: () => void;
  /** The command registry, and what its `enabled` and `run` get. */
  commands: Command[];
  ctx: CommandCtx;
}

function readStoredItems(): QuickItem[] {
  // Each mode saves to local storage as it changes, so reading here sees the latest.
  const stored = load<unknown>("rest-runner.collections", null);
  const collections = stored !== null ? cleanCollections(stored) : migrateSavedRequests(load<unknown[]>("rest-runner.saved", [], isArray).filter(isRequestDef));
  return [
    ...collectionItems(collections),
    ...historyItems(cleanHistory(load<unknown>("rest-runner.history", []))),
    ...suiteItems(cleanSuites(load("rest-runner.test-suites", []))),
    ...flowItems(loadFlows()),
    ...toolItems(loadTools()),
  ];
}

/** Ctrl/Cmd + K: fuzzy search over requests, examples, history, batch runs, suites, cases, test runs, flows, flow runs and tools. */
export function QuickOpen({ mode, onClose, onPick, onClearHistory, commands, ctx }: Props) {
  const [query, setQuery] = useState("");
  const [stored, setItems] = useState<QuickItem[]>(readStoredItems);
  const items = useMemo(() => [...commandItems(commands, ctx), ...stored], [commands, ctx, stored]);
  const mac = isMacPlatform();
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listRuns().catch(() => []), listTestRuns().catch(() => []), listFlowRuns().catch(() => [])]).then(([runs, testRuns, flowRuns]) => {
      if (live)
        setItems((list) => [
          ...list.filter((i) => i.kind !== "batch-run" && i.kind !== "test-run" && i.kind !== "flow-run"),
          ...batchRunItems(runs),
          ...testRunItems(testRuns),
          ...flowRunItems(flowRuns),
        ]);
    });
    return () => {
      live = false;
    };
  }, []);

  const groups = useMemo(() => searchQuickOpen(items, query, KIND_ORDER[mode]), [items, query, mode]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const box = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useExitTransition(backdrop);
  useEscape(onClose);
  useFocusTrap(box);

  /** Runs a command row; a command that returns a query ("Switch environment…") keeps the palette open on it. */
  const pick = (item: QuickItem, permanent = false) => {
    if (item.kind !== "command" || item.payload !== undefined) return onPick(item, permanent);
    const command = commands.find((c) => c.id === item.id);
    if (!command) return;
    const result = command.run(ctx);
    if (result) setQuery(result.query);
    else onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Picking closes Quick open, which turns the Requests shortcuts back on before this key
      // reaches the window: without this, Ctrl/Cmd + Enter would also send the request.
      e.stopPropagation();
      const item = flat[active];
      if (item) pick(item, e.ctrlKey || e.metaKey);
    }
  };

  let index = -1;
  return (
    <div ref={backdrop} data-state="open" className="modal-backdrop quick-open-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="quick-open" role="dialog" aria-modal="true" aria-label="Quick open" onKeyDown={onKeyDown}>
        <label className="quick-open-input">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPaste={(e) => {
              // A whole curl command pasted here opens Import from cURL with it filled in.
              const text = e.clipboardData.getData("text");
              if (looksLikeCurl(text)) {
                e.preventDefault();
                onPick({ kind: "command", id: CURL_COMMAND_ID, title: "Import from cURL…", detail: "", payload: text });
              }
            }}
            placeholder={
              (mode === "testing" ? "Jump to a suite, case or test run" : mode === "flows" ? "Jump to a flow, flow run, suite or case" : mode === "tools" ? "Jump to a tool, request, example or run" : "Jump to a request, example, run or history") + " · type > for commands"
            }
            aria-label="Search"
            aria-controls="quick-open-list"
            aria-activedescendant={flat[active] ? `qo-${active}` : undefined}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="quick-open-list" id="quick-open-list" role="listbox" ref={listRef}>
          {groups.length === 0 && <p className="muted small pad">{query ? "Nothing matches." : "Nothing saved yet."}</p>}
          {groups.map((g) => (
            <div key={g.kind} className="quick-open-group" role="group" aria-label={g.label}>
              <div className="quick-open-group-head">
                <span>{g.label}</span>
                {g.kind === "history" && (
                  <button
                    className="link-btn"
                    onClick={() => {
                      onClearHistory();
                      setItems((list) => list.filter((i) => i.kind !== "history"));
                    }}
                  >
                    Clear history
                  </button>
                )}
              </div>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    id={`qo-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    className={`quick-open-item ${i === active ? "active" : ""}`}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(item)}
                  >
                    {item.method && <span className={`method m-${item.method.toLowerCase()}`}>{item.method}</span>}
                    <span className="quick-open-title">{item.title}</span>
                    <span className="quick-open-detail">{item.detail}</span>
                    {item.shortcut && <kbd className="quick-open-keys">{formatKeys(item.shortcut, mac)}</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="quick-open-foot muted small">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>&gt;</kbd> for commands
          </span>
        </div>
      </div>
    </div>
  );
}
