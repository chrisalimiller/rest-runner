import { useId, useState } from "react";
import { addTableBesideEntry, columnFor, itemFieldOptions, listEntryOf, openItemFields, rowColumnOptions, setEntryChoice, setListShow, takesListEntries, type ListShow } from "../../lib/tools/listBuilder";
import { sampleValue } from "../../lib/tools/builder";
import type { SessionState } from "../../lib/tools/session";
import { DEFAULT_ROWS_MAX, type ListItemChoice, type RowsChoice, type Tool, type ToolBlock, type ToolCall } from "../../lib/tools/types";
import { WhereEditor } from "./ListControls";
import { RefSample } from "./ListValue";

/**
 * Under a field of the Fields step that shows a whole list: how to show it. Joined values and How many are saved on the field,
 * "Its own Table block" adds a block, "One item's fields" opens the first item in the sample tree, and JSON is the plain field.
 */

interface Props {
  work: Tool;
  setWork: (t: Tool) => void;
  block: ToolBlock;
  index: number;
  call: ToolCall;
  /** For the value the entry shows in the sample. */
  state: SessionState;
  /** The sample response the fields are read from. */
  sample: unknown;
  /** Opens a path in the sample tree. */
  onReveal: (path: string) => void;
  /** Tells the dialog a Table block was added, so it can offer Undo. */
  onTableAdded: (blockId: string, title: string) => void;
}

const SHOW_LABELS: Record<ListShow, string> = { joined: "Joined values", count: "How many", table: "Table in this block", json: "JSON" };

/** Whether this field of this block gets the Show as control. */
export function hasShowAs(call: ToolCall | undefined, block: ToolBlock, index: number, sample: unknown): boolean {
  const f = block.fields[index];
  return !!f && takesListEntries(block.type) && !!listEntryOf(call, f, sample);
}

export function ListEntryControls({ work, setWork, block, index, call, state, sample, onReveal, onTableAdded }: Props) {
  const f = block.fields[index];
  const entry = listEntryOf(call, f, sample);
  const id = useId();
  if (!entry) return null;
  const listPath = entry.list ? entry.list.path : f.path;
  const value = sampleValue(sample, listPath === "" ? "$" : listPath);
  const items = Array.isArray(value) ? value : [];
  const single = block.type !== "fields";
  const label = f.label || f.path;
  const item = f.list?.item;
  const filtered = item?.kind === "all" || item?.kind === "count" || item?.kind === "rows" ? item : null;
  const rows: RowsChoice | null = item?.kind === "rows" ? item : null;
  const [typed, setTyped] = useState("");
  const setItem = (next: Extract<ListItemChoice, { kind: "all" | "count" | "rows" }>) => setWork(setEntryChoice(work, block.id, index, { item: next }));

  const choose = (v: string) => {
    if (v === "joined" || v === "count" || v === "table" || v === "json") return setWork(setListShow(work, block.id, index, sample, v));
    if (v === "__table") {
      const added = addTableBesideEntry(work, block.id, index, sample);
      if (!added) return;
      setWork(added.tool);
      const title = added.tool.blocks.find((b) => b.id === added.tableId)?.title ?? "";
      onTableAdded(added.tableId, title);
      return;
    }
    if (v === "__item") {
      const opened = openItemFields(work, block.id, index, sample);
      if (!opened) return;
      setWork(opened.tool);
      onReveal(opened.reveal);
    }
  };

  return (
    <div className="cd-list-entry">
      <p className="small muted cd-entry-size">
        List · {items.length} {items.length === 1 ? "item" : "items"}
      </p>
      <div className="cd-entry-row">
        <label className="small cd-entry-show">
          Show as
          <select value={entry.show} aria-label={`Show ${label} as`} onChange={(e) => choose(e.target.value)}>
            {!single && <option value="table">{SHOW_LABELS.table}</option>}
            <option value="joined">{SHOW_LABELS.joined}</option>
            <option value="count">{SHOW_LABELS.count}</option>
            {!single && <option value="__table">Its own Table block</option>}
            <option value="__item">One item's fields</option>
            <option value="json">{SHOW_LABELS.json}</option>
          </select>
        </label>
        {entry.show === "joined" && item?.kind === "all" && (
          <>
            <label className="small cd-entry-key">
              Key
              <input type="text" className="mono" list={`${id}-keys`} value={f.path} placeholder="$ or $.name" aria-label={`Key of ${label} to join`} spellCheck={false} onChange={(e) => setWork(setEntryChoice(work, block.id, index, { path: e.target.value }))} />
              <datalist id={`${id}-keys`}>
                {itemFieldOptions(items[0]).map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </label>
            <label className="small cd-entry-join">
              Separator
              <input type="text" className="lc-join" value={item.join} aria-label={`Separator for ${label}`} spellCheck={false} onChange={(e) => setItem({ ...item, join: e.target.value })} />
            </label>
          </>
        )}
      </div>
      {rows && (
        <RowsControls
          label={label}
          rows={rows}
          items={items}
          typed={typed}
          setTyped={setTyped}
          onChange={(next) => setItem(next)}
        />
      )}
      {rows && (
        <p className="small muted cd-sample">
          Shows the first {Math.min(items.length, rows.max ?? DEFAULT_ROWS_MAX)} of {items.length} {items.length === 1 ? "item" : "items"}; Save as HTML keeps all of them.
        </p>
      )}
      {f.list && !rows && (
        <p className="cd-sample">
          <RefSample tool={work} call={call} state={state} path={f.path} list={f.list} format={f.format} />
        </p>
      )}
      {filtered && (
        <div className="cd-entry-filter">
          <label className="check small lc-filter">
            <input
              type="checkbox"
              checked={!!filtered.where}
              onChange={(e) => {
                const field = itemFieldOptions(items[0])[0] ?? "";
                const withWhere = { ...filtered, where: { field, op: "eq" as const, value: { fixed: "" } } };
                const { where: _dropped, ...without } = filtered;
                void _dropped;
                setItem(e.target.checked ? withWhere : without);
              }}
            />
            <span>Only where…</span>
          </label>
          {filtered.where && <WhereEditor ctx={{ tool: work, callId: call.id, items: items.slice(0, 1) }} where={filtered.where} label={`${label} filter`} onChange={(w) => setItem({ ...filtered, where: w })} />}
        </div>
      )}
    </div>
  );
}

/** Columns of the Table choice: one checkbox per key found in the sample items, a way to type another path, and the row cap. */
function RowsControls({ label, rows, items, typed, setTyped, onChange }: { label: string; rows: RowsChoice; items: unknown[]; typed: string; setTyped: (v: string) => void; onChange: (r: RowsChoice) => void }) {
  const options = rowColumnOptions(items);
  const chosen = new Set(rows.columns.map((c) => c.path));
  const extra = rows.columns.filter((c) => !options.includes(c.path)).map((c) => c.path);
  const make = (path: string) => columnFor(items, path);
  const toggle = (path: string, on: boolean) => {
    if (on) return onChange({ ...rows, columns: [...rows.columns, make(path)] });
    if (rows.columns.length <= 1) return;
    onChange({ ...rows, columns: rows.columns.filter((c) => c.path !== path) });
  };
  const addTyped = () => {
    const path = typed.trim();
    if (!path || chosen.has(path)) return setTyped("");
    onChange({ ...rows, columns: [...rows.columns, make(path.startsWith("$") ? path : `$.${path}`)] });
    setTyped("");
  };
  return (
    <fieldset className="cd-entry-columns">
      <legend className="small">Columns</legend>
      <div className="cd-entry-chips">
        {[...options, ...extra].map((o) => (
          <label key={o} className="check small cd-entry-chip">
            <input type="checkbox" checked={chosen.has(o)} disabled={chosen.has(o) && rows.columns.length <= 1} onChange={(e) => toggle(o, e.target.checked)} aria-label={`Column ${o} of ${label}`} />
            <span className="mono">{o === "$" ? "Value" : o.replace(/^\$\./, "")}</span>
          </label>
        ))}
      </div>
      <div className="cd-entry-row">
        <label className="small cd-entry-key">
          Another column
          <input type="text" className="mono" value={typed} placeholder="$.name" aria-label={`Type a column path for ${label}`} spellCheck={false} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTyped())} />
        </label>
        <button type="button" className="secondary" disabled={!typed.trim()} onClick={addTyped}>
          Add
        </button>
        <label className="small cd-entry-max">
          Rows shown
          <input type="number" min={1} max={100} value={rows.max ?? DEFAULT_ROWS_MAX} aria-label={`Rows shown for ${label}`} onChange={(e) => onChange({ ...rows, max: Math.min(100, Math.max(1, Math.floor(Number(e.target.value)) || DEFAULT_ROWS_MAX)) })} />
        </label>
      </div>
    </fieldset>
  );
}
