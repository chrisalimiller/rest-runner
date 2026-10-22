import { statusClass } from "../lib/format";
import type { RunSummary } from "../lib/run";
import type { HistoryEntry } from "../lib/types";

interface Props {
  history: HistoryEntry[];
  runs: RunSummary[];
  activeRunId: string | null;
  onOpenRun: (id: string) => void;
  onNew: () => void;
  onOpen: (entry: HistoryEntry) => void;
  onClear: () => void;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

export function Sidebar({ history, runs, activeRunId, onOpenRun, onNew, onOpen, onClear }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">REST Runner</div>
      <button className="primary-outline" onClick={onNew}>
        + New request
      </button>
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>Batch runs</span>
        </div>
        {runs.length === 0 && <p className="muted small">Finished batch runs show up here.</p>}
        <ul className="history runs">
          {runs.map((r) => (
            <li key={r.id}>
              <button className={activeRunId === r.id ? "active" : ""} onClick={() => onOpenRun(r.id)} title={`${r.method} ${r.urlTemplate}\n${r.csvName}`}>
                <span className="run-name">{r.requestName}</span>
                <span className="run-meta">
                  <span className="muted">{when(r.startedAt)}</span>
                  <span className="status ok">{r.passed}</span>
                  {r.failed > 0 && <span className="status bad">{r.failed}✕</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
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
