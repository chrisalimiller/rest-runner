import { statusTone, whenLabel } from "../../lib/earlierSends";
import type { HistoryEntry } from "../../lib/types";
import { OverflowMenu, type MenuItem } from "../shell/OverflowMenu";
import { SearchIcon } from "../shell/Icons";
import { useEscape } from "../useEscape";

export type SidebarTab = "collections" | "history";

interface Props {
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  query: string;
  onQuery: (query: string) => void;
  /** The collections tree (already narrowed to the search), or null when there is nothing to show. */
  tree: React.ReactNode;
  /** The tree is empty because there are no collections at all (not because the search matched nothing). */
  noCollections: boolean;
  history: HistoryEntry[];
  /** Id of the history entry on screen. */
  currentHistoryId: string | null;
  onOpenHistory: (entry: HistoryEntry) => void;
  onNewRequest: () => void;
  onFromCurl: () => void;
  menu: MenuItem[];
  /** Below the window width where it no longer fits beside the panes it floats over them. */
  overlay: boolean;
  onClose: () => void;
}

const MAX_HISTORY_ROWS = 60;

/** The collapsible left column of Requests: collections and folders with their requests, and the send history. */
export function RequestsSidebar(props: Props) {
  useEscape(props.onClose, props.overlay);
  const q = props.query.trim().toLowerCase();
  const rows = props.history
    .filter((h) => q === "" || (h.def?.name ?? "").toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
    .slice(0, MAX_HISTORY_ROWS);
  const now = new Date();

  return (
    <aside className={`requests-sidebar ${props.overlay ? "overlay" : ""}`} aria-label="Collections and history">
      <div className="side-head">
        <div className="segmented small" role="tablist" aria-label="Sidebar">
          <button role="tab" aria-selected={props.tab === "collections"} className={props.tab === "collections" ? "on" : ""} onClick={() => props.onTab("collections")}>
            Collections
          </button>
          <button role="tab" aria-selected={props.tab === "history"} className={props.tab === "history" ? "on" : ""} onClick={() => props.onTab("history")}>
            History
          </button>
        </div>
        <span className="side-head-gap" />
        <OverflowMenu label="Collections menu" items={props.menu} />
      </div>
      <label className="side-search">
        <SearchIcon />
        <input
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder={props.tab === "history" ? "Filter history" : "Filter requests"}
          aria-label={props.tab === "history" ? "Filter history" : "Filter requests"}
          spellCheck={false}
        />
      </label>
      <div className="side-body">
        {props.tab === "collections" ? (
          props.noCollections ? (
            <p className="muted small side-note">No collections yet. Save a request, or import a workspace from the ⋯ menu.</p>
          ) : props.tree ? (
            <div className="tree-scroll">{props.tree}</div>
          ) : (
            <p className="muted small side-note">No requests match.</p>
          )
        ) : rows.length === 0 ? (
          <p className="muted small side-note">{props.history.length === 0 ? "Nothing sent yet." : "No sends match."}</p>
        ) : (
          <div className="hist-list">
            {rows.map((h) => (
              <button key={h.id} className={`hist-row ${h.id === props.currentHistoryId ? "current" : ""}`} onClick={() => props.onOpenHistory(h)} title={`${h.method} ${h.url}`}>
                <span className={`method m-${h.method.toLowerCase()}`}>{h.method}</span>
                <span className="hist-name">{h.def?.name || h.url}</span>
                <span className={`hist-status tone-${statusTone(h.status)}`}>{h.status ?? "ERR"}</span>
                <span className="hist-when">{whenLabel(h.sentAt, now)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {props.tab === "collections" && (
        <div className="side-foot">
          <button className="primary-outline" onClick={props.onNewRequest}>
            + New request
          </button>
          <button className="secondary" onClick={props.onFromCurl} title="Create a request from a pasted curl command">
            From cURL…
          </button>
        </div>
      )}
    </aside>
  );
}
