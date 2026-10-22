import { statusClass } from "../lib/format";
import type { HistoryEntry } from "../lib/types";

interface Props {
  history: HistoryEntry[];
  onNew: () => void;
  onOpen: (entry: HistoryEntry) => void;
  onClear: () => void;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function Sidebar({ history, onNew, onOpen, onClear }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">REST Runner</div>
      <button className="primary-outline" onClick={onNew}>
        + New request
      </button>
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>History</span>
          {history.length > 0 && (
            <button className="link-btn" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
        {history.length === 0 && <p className="muted small">Requests you send show up here.</p>}
        <ul className="history">
          {history.map((h) => (
            <li key={h.id}>
              <button onClick={() => onOpen(h)} title={h.url}>
                <span className={`method m-${h.method.toLowerCase()}`}>{h.method}</span>
                <span className="history-url">{shortUrl(h.url) || "(no URL)"}</span>
                <span className={`history-status ${h.status ? statusClass(h.status) : "bad"}`}>
                  {h.status ?? "ERR"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
