import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ENV_COLOR_VARS, type Environment } from "../../lib/environments";
import { filterEnvs, loadRecentEnvs, pushRecent, recentEnvs, saveRecentEnvs } from "../../lib/envPicker";
import { moveIndex } from "../../lib/listbox";
import { ChevronDownIcon, SearchIcon } from "./Icons";

interface Props {
  environments: Environment[];
  activeId: string | null;
  onChange: (id: string | null) => void;
}

interface Row {
  key: string;
  id: string | null;
  name: string;
  color?: string;
  prod: boolean;
}

const toRow = (e: Environment, group: string): Row => ({
  key: `${group}:${e.id}`,
  id: e.id,
  name: e.name || "(unnamed)",
  color: e.color && e.color !== "none" ? ENV_COLOR_VARS[e.color] : undefined,
  prod: e.isProduction === true,
});

/** Fixed-width trigger and a searchable popover with Recent and All groups; scales to many environments. */
export function EnvPicker({ environments, activeId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecentEnvs());
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId();

  const current = environments.find((e) => e.id === activeId) ?? null;
  const currentName = current ? current.name || "(unnamed)" : "None";
  const currentColor = current && current.color && current.color !== "none" ? ENV_COLOR_VARS[current.color] : undefined;

  const searching = query.trim() !== "";
  const { recentRows, allRows } = useMemo(() => {
    const noneRow = { key: "none", id: null, name: "None", prod: false } as Row;
    const all = [...filterEnvs([noneRow], query), ...filterEnvs(environments, query).map((e) => toRow(e, "all"))];
    const rec = searching ? [] : recentEnvs(environments, recent).map((e) => toRow(e, "recent"));
    return { recentRows: rec, allRows: all };
  }, [environments, query, recent, searching]);
  const rows = [...recentRows, ...allRows];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const focusTrigger = () => (root.current?.querySelector(".env-picker-btn") as HTMLElement | null)?.focus();

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  function show() {
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function choose(row: Row) {
    if (row.id) {
      const next = pushRecent(recent, row.id);
      setRecent(next);
      saveRecentEnvs(next);
    }
    onChange(row.id);
    close();
    focusTrigger();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      focusTrigger();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[active]) choose(rows[active]);
    } else if (e.key === "Tab") {
      close();
    } else {
      const next = moveIndex(active, e.key, rows.length);
      // Home and End stay with the text box so the caret can move.
      if (next !== null && e.key !== "Home" && e.key !== "End") {
        e.preventDefault();
        setActive(next);
      }
    }
  }

  const renderRow = (row: Row, idx: number) => {
    const selected = row.id === (current?.id ?? null);
    return (
      <div
        key={row.key}
        id={`${uid}-${idx}`}
        data-idx={idx}
        role="option"
        aria-selected={selected}
        className={`env-picker-option${idx === active ? " active" : ""}${selected ? " on" : ""}`}
        title={row.name}
        onMouseEnter={() => setActive(idx)}
        onClick={() => choose(row)}
      >
        <span className="env-dot" style={row.color ? { background: row.color } : { visibility: "hidden" }} aria-hidden />
        <span className="env-picker-option-name">{row.name}</span>
        {row.prod && <span className="env-prod-badge">PROD</span>}
      </div>
    );
  };

  return (
    <div className="env-picker" ref={root}>
      <button
        type="button"
        className="env-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Environment: ${currentName}`}
        title={`Environment: ${currentName}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            show();
          }
        }}
      >
        {currentColor ? <span className="env-dot" style={{ background: currentColor }} aria-hidden /> : null}
        <span className="env-dropdown-name">{currentName}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="env-picker-popover" onKeyDown={onKeyDown}>
          <div className="env-picker-search">
            <SearchIcon />
            <input
              ref={input}
              role="combobox"
              aria-expanded
              aria-controls={`${uid}-list`}
              aria-activedescendant={rows.length ? `${uid}-${active}` : undefined}
              aria-label="Search environments"
              placeholder="Search environments"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="env-picker-list" id={`${uid}-list`} role="listbox" aria-label="Environments" ref={list}>
            {rows.length === 0 && <div className="env-picker-empty">No matching environments</div>}
            {recentRows.length > 0 && <div className="env-picker-group">Recent</div>}
            {recentRows.map((r, i) => renderRow(r, i))}
            {allRows.length > 0 && <div className="env-picker-group">{searching ? `Matches (${allRows.length})` : `All (${environments.length})`}</div>}
            {allRows.map((r, i) => renderRow(r, recentRows.length + i))}
          </div>
        </div>
      )}
    </div>
  );
}
