import { useEffect, useMemo, useRef, useState } from "react";
import { cleanCollections, migrateSavedRequests, isRequestDef } from "../../lib/collections";
import {
  batchRunItems,
  collectionItems,
  flowItems,
  flowRunItems,
  historyItems,
  KIND_ORDER,
  searchQuickOpen,
  suiteItems,
  testRunItems,
  type QuickItem,
} from "../../lib/quickOpen";
import { listRuns } from "../../lib/runStore";
import { load } from "../../lib/storage";
import { cleanSuites } from "../../lib/testing/suites";
import { listTestRuns } from "../../lib/testing/testRunStore";
import { listFlowRuns } from "../../lib/flows/flowRunStore";
import { loadFlows } from "../../lib/flows/flows";
import type { HistoryEntry } from "../../lib/types";
import { useEscape } from "../useEscape";
import { useFocusTrap } from "../useFocusTrap";
import { SearchIcon } from "./Icons";
import type { Mode } from "./TopBar";

interface Props {
  mode: Mode;
  onClose: () => void;
  onPick: (item: QuickItem) => void;
  onClearHistory: () => void;
}

function readStoredItems(): QuickItem[] {
  // Each mode saves to local storage as it changes, so reading here sees the latest.
  const stored = load<unknown>("rest-runner.collections", null);
  const collections = stored !== null ? cleanCollections(stored) : migrateSavedRequests(load<unknown[]>("rest-runner.saved", []).filter(isRequestDef));
  return [
    ...collectionItems(collections),
    ...historyItems(load<HistoryEntry[]>("rest-runner.history", [])),
    ...suiteItems(cleanSuites(load("rest-runner.test-suites", []))),
    ...flowItems(loadFlows()),
  ];
}

/** Ctrl/Cmd + K: fuzzy search over requests, examples, history, batch runs, suites, cases, test runs, flows and flow runs. */
export function QuickOpen({ mode, onClose, onPick, onClearHistory }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<QuickItem[]>(readStoredItems);
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
  useEscape(onClose);
  useFocusTrap(box);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active];
      if (item) onPick(item);
    }
  };

  let index = -1;
  return (
    <div className="modal-backdrop quick-open-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="quick-open" role="dialog" aria-modal="true" aria-label="Quick open" onKeyDown={onKeyDown}>
        <label className="quick-open-input">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "testing" ? "Jump to a suite, case or test run…" : mode === "flows" ? "Jump to a flow, flow run, suite or case…" : "Jump to a request, example, run or history…"
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
                    onClick={() => onPick(item)}
                  >
                    {item.method && <span className={`method m-${item.method.toLowerCase()}`}>{item.method}</span>}
                    <span className="quick-open-title">{item.title}</span>
                    <span className="quick-open-detail">{item.detail}</span>
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
        </div>
      </div>
    </div>
  );
}
