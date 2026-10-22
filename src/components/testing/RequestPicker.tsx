import { useMemo, useState } from "react";
import { listPickableRequests, type PickableRequest } from "../../lib/testing/requestSources";

interface Props {
  onPick: (requests: PickableRequest[]) => void;
  onClose: () => void;
}

/** Lists saved requests (and their examples) so they can be added to a suite as test cases. */
export function RequestPicker({ onPick, onClose }: Props) {
  const all = useMemo(() => listPickableRequests(), []);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const q = query.trim().toLowerCase();
  const shown = all.filter((r) => !q || `${r.path.join(" ")} ${r.request.method} ${r.request.url}`.toLowerCase().includes(q));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add saved requests">
        <div className="modal-head">
          <h3>Add saved requests as test cases</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="picker-body">
          <input className="search" type="search" placeholder="Search name, folder or URL" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {all.length === 0 && <p className="muted small">No saved requests yet. Save requests in the Requests section first, or add a blank case.</p>}
          <ul className="picker-list">
            {shown.map((r) => (
              <li key={r.id}>
                <label className={picked.includes(r.id) ? "active" : ""}>
                  <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span className={`method m-${r.request.method.toLowerCase()}`}>{r.request.method}</span>
                  <span className="picker-name">
                    {r.path.slice(0, -1).map((p, i) => (
                      <span key={i} className="muted">
                        {p} ›{" "}
                      </span>
                    ))}
                    {r.isExample && <span className="muted">example: </span>}
                    {r.path[r.path.length - 1]}
                  </span>
                  <span className="muted small picker-url">{r.request.url}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-foot">
          <span className="muted small">Each case gets its own copy, so editing a case does not change the saved request.</span>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="send" disabled={picked.length === 0} onClick={() => onPick(picked.map((id) => all.find((r) => r.id === id)!).filter(Boolean))}>
            Add {picked.length || ""} case{picked.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
