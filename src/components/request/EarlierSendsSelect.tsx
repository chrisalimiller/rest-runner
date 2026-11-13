import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { earlierSendLabel, earlierSendTone, sendTooltip, whenLabel, type EarlierSend } from "../../lib/earlierSends";
import { moveIndex } from "../../lib/listbox";
import type { HistoryEntry } from "../../lib/types";

interface Props {
  items: EarlierSend[];
  /** Id of the send on screen (a history entry), or null when the response is the live one. */
  currentId: string | null;
  /** The environment selected now; sends from another one name theirs. */
  envName?: string;
  /** The whole history, for the "what changed since the previous send" tooltips. */
  history: HistoryEntry[];
  onOpen: (item: EarlierSend) => void;
}

const idOf = (item: EarlierSend) => (item.kind === "send" ? item.entry.id : item.run.id);

/**
 * The pill at the end of the response status field: "Latest ▾" or "11m ago ▾". Opens a listbox of this request's
 * earlier sends and batch runs, built like the method dropdown at the other end of the URL bar.
 */
export function EarlierSendsSelect({ items, currentId, envName, history, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const now = new Date();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (items.length === 0) return null;

  const current = items.findIndex((it) => it.kind === "send" && it.entry.id === currentId);
  const text = current === 0 ? "Latest" : current > 0 ? whenLabel(items[current].at, now) : `${items.length} earlier`;
  const dotTone = current >= 0 ? earlierSendTone(items[current]) : earlierSendTone(items[0]);

  const show = () => {
    setActive(Math.max(0, current));
    setOpen(true);
  };
  const choose = (i: number) => {
    setOpen(false);
    onOpen(items[i]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === "Tab") return setOpen(false);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) show();
      else choose(active);
      return;
    }
    const next = moveIndex(open ? active : Math.max(0, current), e.key, items.length);
    if (next !== null) {
      e.preventDefault();
      if (open) setActive(next);
      else show();
    }
  };

  return (
    <div ref={root} className="earlier-select">
      <button
        type="button"
        role="combobox"
        className="earlier-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-label="Earlier sends of this request"
        title="Earlier sends of this request"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <i className={`send-dot tone-${dotTone}`} aria-hidden />
        <span>{text}</span>
        <span className="earlier-caret" aria-hidden />
      </button>
      {open && (
        <div id={`${id}-list`} role="listbox" className="earlier-list-popup" aria-label="Earlier sends of this request">
          <div className="earlier-list-head">Sends of this request</div>
          {items.map((item, i) => (
            <div
              key={idOf(item)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === current}
              className={`earlier-option ${i === active ? "active" : ""} ${i === current ? "current" : ""}`}
              title={item.kind === "send" ? sendTooltip(item.entry, history) : `Open the batch run from ${item.run.csvName}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <i className={`send-dot tone-${earlierSendTone(item)}`} aria-hidden />
              <span className="earlier-option-label">{earlierSendLabel(item, now, envName)}</span>
              {i === 0 && <span className="earlier-option-tag">Latest</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
