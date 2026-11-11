import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listPickableRequests, type PickableRequest } from "../../lib/testing/requestSources";
import { requestLine } from "../../lib/tools/view";
import { CheckIcon, SearchIcon } from "../shell/Icons";

/** What a dragged saved request carries, so the Calls column (or any later source) can accept it. */
export const REQUEST_DRAG_TYPE = "application/x-rest-runner-request";

const FLYOUT_ID = "add-request-flyout";
const GAP = 10;
const EDGE = 8;

interface Option {
  r: PickableRequest;
  name: string;
  folder: string;
  url: string;
  search: string;
}

function toOption(r: PickableRequest): Option {
  // An example's path ends "...folder, request, example"; it sits in its request's folder under the combined name.
  const folderPath = r.path.slice(0, r.isExample ? -2 : -1);
  const name = r.isExample ? r.request.name : r.path[r.path.length - 1];
  const folder = folderPath.join(" › ");
  const url = requestLine(r.request)?.path ?? r.request.url;
  return { r, name, folder, url, search: `${folder} ${r.request.method} ${r.request.url} ${name}`.toLowerCase() };
}

interface Props {
  /** The Add request button: the flyout hangs off the right edge of its column, level with it. */
  anchor: React.RefObject<HTMLButtonElement | null>;
  /** How many calls in this tool already use each request id. */
  counts: Map<string, number>;
  onAdd: (r: PickableRequest) => void;
  /** `toButton` is true when focus should go back to the Add request button (Esc). */
  onClose: (toButton: boolean) => void;
}

/** The saved-request picker for the Calls column. It floats over the block page so the Calls list stays in view. */
export function AddRequestFlyout({ anchor, counts, onAdd, onClose }: Props) {
  const all = useMemo(() => listPickableRequests().map(toOption), []);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [just, setJust] = useState<string | null>(null);
  const [place, setPlace] = useState<{ style: React.CSSProperties; caret: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const timer = useRef(0);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => all.filter((o) => !q || o.search.includes(q)), [all, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Fixed layer, so no scrolling pane clips it. Level with the button, just right of the Calls column, clamped to the window.
  useLayoutEffect(() => {
    const measure = () => {
      const btn = anchor.current?.getBoundingClientRect();
      if (!btn) return;
      const col = anchor.current?.closest("aside")?.getBoundingClientRect();
      const maxHeight = Math.min(480, window.innerHeight - EDGE * 2);
      const left0 = (col?.right ?? btn.right) + GAP;
      const width = Math.max(240, Math.min(380, window.innerWidth - left0 - EDGE));
      const left = Math.max(EDGE, Math.min(left0, window.innerWidth - width - EDGE));
      const height = Math.min(box.current?.offsetHeight ?? maxHeight, maxHeight);
      const top = Math.max(EDGE, Math.min(btn.top - 6, window.innerHeight - EDGE - height));
      const caret = Math.max(12, Math.min(btn.top + btn.height / 2 - top - 5, height - 22));
      setPlace({ style: { left, top, width, maxHeight }, caret });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor, shown.length]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [anchor, onClose]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`#${FLYOUT_ID}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, shown]);

  const add = (i: number) => {
    const o = shown[i];
    if (!o) return;
    setActive(i);
    onAdd(o.r);
    setJust(o.r.id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setJust(null), 1200);
    input.current?.focus({ preventScroll: true });
  };

  let lastFolder: string | null = null;
  return createPortal(
    <div
      ref={box}
      id={FLYOUT_ID}
      className="add-request-flyout"
      role="dialog"
      aria-label="Add a saved request"
      style={place?.style ?? { visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose(true);
        }
      }}
    >
      <span className="add-request-caret" style={{ top: place?.caret ?? 12 }} aria-hidden="true" />
      <div className="add-request-field">
        <SearchIcon size={14} />
        <input
          ref={input}
          type="text"
          placeholder="Search name, folder or URL"
          aria-label="Search saved requests"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${FLYOUT_ID}-list`}
          aria-activedescendant={shown.length ? `${FLYOUT_ID}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(shown.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              add(active);
            }
          }}
        />
      </div>
      <ul ref={list} id={`${FLYOUT_ID}-list`} className="add-request-list" role="listbox" aria-label="Saved requests">
        {shown.length === 0 && (
          <li className="add-request-none muted small" role="presentation">
            {all.length === 0 ? "No saved requests yet. Save requests in the Requests section first." : `No saved request matches "${query.trim()}".`}
          </li>
        )}
        {shown.map((o, i) => {
          const heading = o.folder !== lastFolder;
          lastFolder = o.folder;
          const n = counts.get(o.r.id) ?? 0;
          return (
            <li key={o.r.id} role="presentation">
              {heading && o.folder && <div className="add-request-group">{o.folder}</div>}
              <div
                id={`${FLYOUT_ID}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`add-request-row ${i === active ? "on" : ""}`}
                draggable
                title={`${o.name}: click to add, or drag into Calls`}
                onClick={() => add(i)}
                onMouseMove={() => i !== active && setActive(i)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(REQUEST_DRAG_TYPE, o.r.id);
                  e.dataTransfer.setData("text/plain", o.name);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <span className="add-request-grip" aria-hidden="true">
                  <svg viewBox="0 0 10 14" width="10" height="14">
                    <g fill="currentColor">
                      <circle cx="3" cy="3" r="1.2" />
                      <circle cx="7" cy="3" r="1.2" />
                      <circle cx="3" cy="7" r="1.2" />
                      <circle cx="7" cy="7" r="1.2" />
                      <circle cx="3" cy="11" r="1.2" />
                      <circle cx="7" cy="11" r="1.2" />
                    </g>
                  </svg>
                </span>
                <span className={`method m-${o.r.request.method.toLowerCase()}`}>{o.r.request.method}</span>
                <span className="add-request-main">
                  <span className="add-request-name">
                    {o.r.isExample && <span className="muted">example: </span>}
                    {o.name}
                  </span>
                  <span className="add-request-url mono">{o.url}</span>
                </span>
                {just === o.r.id ? (
                  <span className="add-request-pill ok">
                    <CheckIcon size={11} />
                    Added
                  </span>
                ) : (
                  n > 0 && (
                    <span className="add-request-pill" title={`Already in this tool${n > 1 ? ` ${n} times` : ""}`}>
                      Added{n > 1 ? ` ×${n}` : ""}
                    </span>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="add-request-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>Enter</kbd> add
        </span>
        <span>or drag into Calls</span>
        <span className="push">
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>,
    document.body,
  );
}
