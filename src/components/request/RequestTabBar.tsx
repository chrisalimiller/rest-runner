import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Collection } from "../../lib/collections";
import { groupTabs, tabMonogram, type RequestTab } from "../../lib/requestTabs";
import { ChevronDownIcon } from "../shell/Icons";
import { MOD_KEY } from "../shell/TopBar";
import { useEscape } from "../useEscape";
import "./requestTabs.css";

interface Props {
  tabs: RequestTab[];
  activeId: string;
  collections: Collection[];
  /** Tabs with unsaved changes. */
  dirtyIds: ReadonlySet<string>;
  /** Tabs with a send or a batch in flight. */
  busyIds: ReadonlySet<string>;
  canReopen: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Opens Import from cURL (the + button's right-click menu). */
  onNewFromCurl: () => void;
  onPin: (id: string) => void;
  onUnpin: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReveal: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseSaved: () => void;
  onReopen: () => void;
}

/** The bar shows with two or more tabs, or any pinned tab. */
export function showTabBar(tabs: RequestTab[]): boolean {
  return tabs.length >= 2 || tabs.some((t) => t.pinned);
}

function Spinner() {
  return <span className="rtab-spinner" role="img" aria-label="Sending" />;
}

/** Open requests as tabs: pinned ones as monograms, the rest grouped by where they are saved. */
export function RequestTabBar(props: Props) {
  const { tabs, activeId, collections, dirtyIds, busyIds } = props;
  const { pinned, groups } = useMemo(() => groupTabs(tabs, collections), [tabs, collections]);
  /** Every tab's group name, pinned ones included, for its accessible name. */
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groupTabs(tabs.map((t) => ({ ...t, pinned: false })), collections).groups) for (const t of g.tabs) map.set(t.id, g.label);
    return map;
  }, [tabs, collections]);
  const order = useMemo(() => [...pinned, ...groups.flatMap((g) => g.tabs)], [pinned, groups]);

  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<"none" | "left" | "right" | "both">("none");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);

  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade(left && right ? "both" : left ? "left" : right ? "right" : "none");
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      ro?.disconnect();
    };
  }, []);
  useEffect(() => {
    const tab = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`);
    tab?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activeId, tabs.length]);

  const focusTab = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus();

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[role=tab]");
    if (!target || e.altKey || e.ctrlKey || e.metaKey) return;
    const id = target.dataset.tabId!;
    const i = order.findIndex((t) => t.id === id);
    let to: number | null = null;
    if (e.key === "ArrowRight") to = Math.min(order.length - 1, i + 1);
    else if (e.key === "ArrowLeft") to = Math.max(0, i - 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = order.length - 1;
    else if (e.key === "Delete") {
      e.preventDefault();
      props.onClose(id);
      return;
    }
    if (to !== null) {
      e.preventDefault();
      focusTab(order[to].id);
    }
  };

  const tabLabel = (t: RequestTab) =>
    [`${t.def.method} ${t.def.name || "Untitled request"}`, groupOf.get(t.id), t.pinned ? "pinned" : null, dirtyIds.has(t.id) ? "unsaved changes" : null, busyIds.has(t.id) ? "sending" : null]
      .filter(Boolean)
      .join(", ");

  const renderTab = (t: RequestTab) => {
    const active = t.id === activeId;
    const dirty = dirtyIds.has(t.id);
    const busy = busyIds.has(t.id);
    const name = t.def.name || "Untitled request";
    const common = {
      role: "tab" as const,
      "aria-selected": active,
      "aria-controls": "request-panel",
      "aria-label": tabLabel(t),
      "data-tab-id": t.id,
      tabIndex: active ? 0 : -1,
      onClick: () => props.onActivate(t.id),
    };
    const wrapProps = {
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        setMenu({ id: t.id, x: e.clientX, y: e.clientY });
      },
      onAuxClick: (e: React.MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
          props.onClose(t.id);
        }
      },
      // Keeps middle-click from starting autoscroll.
      onMouseDown: (e: React.MouseEvent) => e.button === 1 && e.preventDefault(),
    };
    if (t.pinned) {
      return (
        <div key={t.id} className={`rtab-wrap pinned ${active ? "on" : ""}`} role="presentation" {...wrapProps}>
          <button {...common} className={`rtab-pin m-${t.def.method.toLowerCase()}`} title={`${name} (${t.def.method}, pinned)`}>
            {tabMonogram(t.def.name, t.def.method)}
          </button>
          {busy ? <span className="rtab-pin-badge"><Spinner /></span> : dirty ? <span className="rtab-dot rtab-pin-badge" aria-hidden /> : null}
        </div>
      );
    }
    return (
      <div key={t.id} className={`rtab-wrap ${active ? "on" : ""} ${dirty ? "dirty" : ""}`} role="presentation" {...wrapProps}>
        <button {...common} className="rtab" title={`${name}\n${t.def.method} ${t.def.url || ""}`.trim()}>
          {busy ? <Spinner /> : <span className={`rtab-method m-${t.def.method.toLowerCase()}`}>{t.def.method}</span>}
          <span className={`rtab-name ${t.preview ? "preview" : ""}`}>{name}</span>
        </button>
        <span className="rtab-slot">
          {dirty && <span className="rtab-dot" aria-hidden />}
          <button className="rtab-x" tabIndex={-1} aria-label={`Close ${name}`} title="Close" onClick={() => props.onClose(t.id)}>
            ×
          </button>
        </span>
      </div>
    );
  };

  return (
    <div className="rtab-bar">
      <div className="rtab-list" role="tablist" aria-label="Open requests" ref={listRef} onKeyDown={onKeyDown}>
        {pinned.length > 0 && (
          <>
            <div className="rtab-pins">{pinned.map(renderTab)}</div>
            <span className="rtab-divider" aria-hidden />
          </>
        )}
        <div className="rtab-scroll" data-fade={fade} ref={scrollRef} onScroll={measure}>
          {groups.map((g, gi) => (
            <div key={g.key} className="rtab-group" role="presentation">
              {gi > 0 && <span className="rtab-divider" aria-hidden />}
              <span className={`rtab-label tone-${g.tone}`} aria-hidden="false" title={g.label}>
                {g.label}
              </span>
              {g.tabs.map(renderTab)}
            </div>
          ))}
        </div>
      </div>
      <button
        className="rtab-add"
        onClick={props.onNew}
        onContextMenu={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setAddMenu({ x: r.left, y: r.bottom + 2 });
        }}
        aria-label="New request tab"
        title={`New request tab (${MOD_KEY} T). Right-click for more.`}
      >
        +
      </button>
      <AllTabs {...props} groups={groups} pinned={pinned} />
      {addMenu && (
        <PopoverMenu
          label="New request"
          x={addMenu.x}
          y={addMenu.y}
          onDone={() => setAddMenu(null)}
          items={[
            { label: "New request", run: props.onNew },
            { label: "New from cURL…", run: props.onNewFromCurl },
          ]}
        />
      )}
      {menu && <TabMenu {...props} tab={tabs.find((t) => t.id === menu.id)} x={menu.x} y={menu.y} onDone={() => setMenu(null)} />}
    </div>
  );
}

/** A small context menu at a point: arrow keys move, Escape or a click elsewhere closes it. */
function PopoverMenu({ items, label, x, y, onDone }: { items: { label: string; run: () => void; separated?: boolean }[]; label: string; x: number; y: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onDone);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDone();
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [onDone]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (e.key === "ArrowDown") to = (i + 1) % buttons.length;
    else if (e.key === "ArrowUp") to = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = buttons.length - 1;
    else if (e.key === "Tab") onDone();
    if (to >= 0) {
      e.preventDefault();
      buttons[to].focus();
    }
  };
  const left = Math.min(x, window.innerWidth - 210);
  const top = Math.min(y, window.innerHeight - 220);
  return (
    <div className="overflow-popover" role="menu" aria-label={label} ref={ref} style={{ left, top }} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={`overflow-item ${item.separated ? "separated" : ""}`}
          onClick={() => {
            onDone();
            item.run();
          }}
        >
          <span className="overflow-icon" aria-hidden />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function TabMenu(props: Props & { tab: RequestTab | undefined; x: number; y: number; onDone: () => void }) {
  const { tab, onDone } = props;
  if (!tab) return null;
  const items: { label: string; run: () => void; separated?: boolean }[] = [
    tab.pinned ? { label: "Unpin", run: () => props.onUnpin(tab.id) } : { label: "Pin", run: () => props.onPin(tab.id) },
    { label: "Duplicate", run: () => props.onDuplicate(tab.id) },
    { label: "Reveal in collections", run: () => props.onReveal(tab.id) },
    { label: "Close", run: () => props.onClose(tab.id), separated: true },
    { label: "Close others", run: () => props.onCloseOthers(tab.id) },
    { label: "Close saved tabs", run: props.onCloseSaved },
  ];
  return <PopoverMenu items={items} label={`Actions for ${tab.def.name}`} x={props.x} y={props.y} onDone={onDone} />;
}

/** The ▾ button: every open tab, grouped like the bar, with a filter. */
function AllTabs(props: Props & { groups: ReturnType<typeof groupTabs>["groups"]; pinned: RequestTab[] }) {
  const { groups, pinned, activeId, dirtyIds } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  useEscape(() => setOpen(false), open);
  // The popover is hidden until it has a position, and a hidden input cannot take focus.
  useEffect(() => {
    if (pos) filter.current?.focus();
  }, [pos]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setPos(null);
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    const down = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = (t: RequestTab, group: string) => q === "" || `${t.def.method} ${t.def.name} ${group}`.toLowerCase().includes(q);
  const sections = [
    ...(pinned.length ? [{ key: "pinned", label: "Pinned", tabs: pinned }] : []),
    ...groups.map((g) => ({ key: g.key, label: g.label, tabs: g.tabs })),
  ]
    .map((s) => ({ ...s, tabs: s.tabs.filter((t) => matches(t, s.label)) }))
    .filter((s) => s.tabs.length > 0);
  const flat = sections.flatMap((s) => s.tabs);
  const at = Math.min(cursor, Math.max(0, flat.length - 1));

  const choose = (t: RequestTab) => {
    setOpen(false);
    props.onActivate(t.id);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setCursor((at + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      if (flat[at]) choose(flat[at]);
    }
  };

  return (
    <>
      <button
        ref={button}
        className="rtab-add rtab-all"
        aria-label="All open tabs"
        title="All open tabs"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="overflow-popover rtab-all-pop" role="dialog" aria-label="All open tabs" ref={pop} onKeyDown={onKeyDown} style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }}>
          <input
            className="rtab-filter"
            ref={filter}
            placeholder="Filter open tabs"
            aria-label="Filter open tabs"
            role="combobox"
            aria-expanded
            aria-controls="rtab-all-list"
            aria-activedescendant={flat[at] ? `rtab-opt-${flat[at].id}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />
          <div className="rtab-all-list" id="rtab-all-list" role="listbox" aria-label="Open tabs">
            {sections.length === 0 && <p className="muted small rtab-none">No open tab matches.</p>}
            {sections.map((s) => (
              <div key={s.key} role="group" aria-label={s.label}>
                <div className="rtab-all-head">{s.label}</div>
                {s.tabs.map((t) => (
                  <button
                    key={t.id}
                    id={`rtab-opt-${t.id}`}
                    tabIndex={-1}
                    role="option"
                    aria-selected={t.id === activeId}
                    className={`overflow-item rtab-opt ${flat[at]?.id === t.id ? "cursor" : ""} ${t.id === activeId ? "current" : ""}`}
                    onMouseEnter={() => setCursor(flat.indexOf(t))}
                    onClick={() => choose(t)}
                  >
                    <span className={`rtab-method m-${t.def.method.toLowerCase()}`}>{t.def.method}</span>
                    <span className="rtab-opt-name">{t.def.name || "Untitled request"}</span>
                    {dirtyIds.has(t.id) && <span className="rtab-dot" role="img" aria-label="Unsaved changes" />}
                    {t.pinned && <span className="rtab-pinned-tag">Pinned</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="rtab-all-foot">
            <button
              className="overflow-item"
              onClick={() => {
                setOpen(false);
                props.onCloseSaved();
              }}
            >
              Close saved tabs
            </button>
            <button
              className="overflow-item"
              disabled={!props.canReopen}
              onClick={() => {
                setOpen(false);
                props.onReopen();
              }}
            >
              Reopen closed tab
              <kbd className="overflow-hint">{MOD_KEY} ⇧ T</kbd>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
