import { useId } from "react";
import { CHOICE_KINDS, CHOICE_LABELS, RULE_KINDS, RULE_LABELS, choiceKind, choiceOfKind, itemFieldOptions, ruleKind, ruleOfKind, type ChoiceKind, type RuleKind } from "../../lib/tools/listBuilder";
import { choiceText } from "../../lib/tools/listText";
import type { ItemRule, ListItemChoice, ListRef, PlaceholderMapping, Tool, Where } from "../../lib/tools/types";

/**
 * The controls that say which item of a list a value comes from, shared by the Calls column (a list's own rule)
 * and the Connect dialog (one value's choice). Every control edits plain data; the parent keeps the tool.
 */

export interface ListCtx {
  tool: Tool;
  /** The call that owns the list. */
  callId: string;
  /** Items of the list in the sample response, to suggest fields. */
  items: readonly unknown[];
}

type SourceKind = "input" | "call" | "fixed";

function sourceKind(m: PlaceholderMapping): SourceKind {
  return m.input !== undefined ? "input" : m.call ? "call" : "fixed";
}

const SOURCE_LABELS: Record<SourceKind, string> = { input: "An input", call: "Another request's field", fixed: "Fixed text" };

/** What a "where" compares with: an input, fixed text, or a field of a request (optionally from one of its lists). */
export function ValueSourceEditor({ ctx, value, onChange, label, depth = 0 }: { ctx: ListCtx; value: PlaceholderMapping; onChange: (m: PlaceholderMapping) => void; label: string; depth?: number }) {
  const kind = sourceKind(value);
  const { tool } = ctx;
  const setKind = (k: SourceKind) => {
    if (k === kind) return;
    if (k === "input") onChange({ input: tool.inputs[0]?.name ?? "" });
    else if (k === "call") onChange({ call: { callId: tool.calls.find((c) => c.id !== ctx.callId)?.id ?? ctx.callId, path: "" } });
    else onChange({ fixed: "" });
  };
  const srcCall = value.call ? tool.calls.find((c) => c.id === value.call!.callId) : undefined;
  const srcLists = srcCall && !srcCall.pickRow ? (srcCall.lists ?? []) : [];
  return (
    <span className="lc-value">
      <select value={kind} aria-label={`${label}: where it comes from`} onChange={(e) => setKind(e.target.value as SourceKind)}>
        {(Object.keys(SOURCE_LABELS) as SourceKind[]).map((k) => (
          <option key={k} value={k} disabled={k === "input" && tool.inputs.length === 0}>
            {SOURCE_LABELS[k]}
          </option>
        ))}
      </select>
      {kind === "input" && (
        <select value={value.input ?? ""} aria-label={`${label}: input`} onChange={(e) => onChange({ input: e.target.value })}>
          {!tool.inputs.some((i) => i.name === value.input) && <option value={value.input}>{value.input || "(choose an input)"}</option>}
          {tool.inputs.map((i) => (
            <option key={i.name} value={i.name}>
              {i.label || i.name}
            </option>
          ))}
        </select>
      )}
      {kind === "fixed" && <input type="text" value={value.fixed ?? ""} aria-label={`${label}: text`} placeholder="Text to compare with" spellCheck={false} onChange={(e) => onChange({ fixed: e.target.value })} />}
      {kind === "call" && value.call && (
        <>
          <select value={value.call.callId} aria-label={`${label}: request`} onChange={(e) => onChange({ call: { callId: e.target.value, path: value.call!.path } })}>
            {!srcCall && <option value={value.call.callId}>(a removed request)</option>}
            {tool.calls.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {srcLists.length > 0 && (
            <select
              value={value.call.list?.listId ?? ""}
              aria-label={`${label}: list`}
              onChange={(e) => onChange({ call: { callId: value.call!.callId, path: value.call!.path, ...(e.target.value ? { list: { listId: e.target.value, item: { kind: "ask" } as ItemRule } } : {}) } })}
            >
              <option value="">Whole response</option>
              {srcLists.map((l) => (
                <option key={l.id} value={l.id}>
                  List: {l.name}
                </option>
              ))}
            </select>
          )}
          <input type="text" className="mono" value={value.call.path} aria-label={`${label}: field`} placeholder="$.id" spellCheck={false} onChange={(e) => onChange({ call: { ...value.call!, path: e.target.value } })} />
          {value.call.list && depth < 1 && (
            <ChoiceEditor ctx={{ ...ctx, callId: value.call.callId, items: [] }} listRule={srcLists.find((l) => l.id === value.call!.list!.listId)?.choose} choice={value.call.list.item} onChange={(item) => onChange({ call: { ...value.call!, list: withItem(value.call!.list!, item) } })} label={`${label}: item`} depth={depth + 1} />
          )}
        </>
      )}
    </span>
  );
}

function withItem(ref: ListRef, item: ListItemChoice | undefined): ListRef {
  return item ? { listId: ref.listId, item } : { listId: ref.listId };
}

/** "Where field = value": the field is a path inside an item. */
export function WhereEditor({ ctx, where, onChange, label, depth = 0 }: { ctx: ListCtx; where: Where; onChange: (w: Where) => void; label: string; depth?: number }) {
  const listId = useId();
  const options = itemFieldOptions(ctx.items[0]);
  return (
    <span className="lc-where">
      <input type="text" className="mono" list={listId} value={where.field} placeholder="$.status" aria-label={`${label}: field of the item`} spellCheck={false} onChange={(e) => onChange({ ...where, field: e.target.value })} />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <select value={where.op} aria-label={`${label}: equals or not`} onChange={(e) => onChange({ ...where, op: e.target.value as "eq" | "ne" })}>
        <option value="eq">is</option>
        <option value="ne">is not</option>
      </select>
      <ValueSourceEditor ctx={ctx} value={where.value} label={label} depth={depth} onChange={(value) => onChange({ ...where, value })} />
    </span>
  );
}

function RowNumber({ index, onChange, label }: { index: number; onChange: (i: number) => void; label: string }) {
  // Shown from 1; stored from 0, with negative numbers counting from the end.
  const shown = index >= 0 ? index + 1 : index;
  return (
    <input
      type="number"
      className="lc-row-number"
      value={shown}
      aria-label={`${label}: row number`}
      title="1 is the first row. -1 is the last."
      onChange={(e) => {
        const n = Math.trunc(Number(e.target.value));
        if (!Number.isFinite(n) || n === 0) return;
        onChange(n > 0 ? n - 1 : n);
      }}
    />
  );
}

/** A list's own rule: which item it hands on by default. */
export function RuleEditor({ ctx, rule, onChange, label }: { ctx: ListCtx; rule: ItemRule; onChange: (r: ItemRule) => void; label: string }) {
  const kind = ruleKind(rule);
  const field = itemFieldOptions(ctx.items[0])[0] ?? "";
  return (
    <span className="lc-rule">
      <select value={kind} aria-label={`${label}: which item`} onChange={(e) => onChange(ruleOfKind(e.target.value as RuleKind, rule, field))}>
        {RULE_KINDS.map((k) => (
          <option key={k} value={k}>
            {RULE_LABELS[k]}
          </option>
        ))}
      </select>
      {kind === "index" && rule.kind === "index" && <RowNumber index={rule.index} label={label} onChange={(index) => onChange({ kind: "index", index })} />}
      {rule.kind === "where" && <WhereEditor ctx={ctx} where={rule} label={label} onChange={(w) => onChange({ kind: "where", ...w })} />}
    </span>
  );
}

/** One value's choice of item: the list's own rule, a different rule, all items joined, or how many. */
export function ChoiceEditor({ ctx, listRule, choice, onChange, label, depth = 0 }: { ctx: ListCtx; listRule: ItemRule | undefined; choice: ListItemChoice | undefined; onChange: (c: ListItemChoice | undefined) => void; label: string; depth?: number }) {
  const kind = choiceKind(choice);
  const field = itemFieldOptions(ctx.items[0])[0] ?? "";
  const kinds = CHOICE_KINDS.filter((k) => (k !== "where" && k !== "all" && k !== "count") || depth < 1 || k === "where");
  const inList = listRule ? `Same as the list (${choiceText(listRule, ctx.tool)})` : CHOICE_LABELS.list;
  const where = choice?.kind === "where" ? choice : (choice?.kind === "all" || choice?.kind === "count") && choice.where ? choice.where : null;
  return (
    <span className="lc-choice">
      <select value={kind} aria-label={`${label}: which item`} onChange={(e) => onChange(choiceOfKind(e.target.value as ChoiceKind, choice, field))}>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {k === "list" ? inList : CHOICE_LABELS[k]}
          </option>
        ))}
      </select>
      {choice?.kind === "index" && kind === "index" && <RowNumber index={choice.index} label={label} onChange={(index) => onChange({ kind: "index", index })} />}
      {choice?.kind === "where" && <WhereEditor ctx={ctx} where={choice} label={label} depth={depth} onChange={(w) => onChange({ kind: "where", ...w })} />}
      {choice?.kind === "all" && <input type="text" className="lc-join" value={choice.join} aria-label={`${label}: join with`} title="Put this between the values" spellCheck={false} onChange={(e) => onChange({ ...choice, join: e.target.value })} />}
      {(choice?.kind === "all" || choice?.kind === "count") && (
        <label className="check small lc-filter">
          <input
            type="checkbox"
            checked={!!choice.where}
            onChange={(e) => onChange(e.target.checked ? { ...choice, where: { field, op: "eq", value: { fixed: "" } } } : withoutWhere(choice))}
          />
          <span>Only where…</span>
        </label>
      )}
      {(choice?.kind === "all" || choice?.kind === "count") && where && <WhereEditor ctx={ctx} where={where} label={`${label} filter`} depth={depth} onChange={(w) => onChange({ ...choice, where: w })} />}
    </span>
  );
}

function withoutWhere(c: Extract<ListItemChoice, { kind: "all" | "count" }>): ListItemChoice {
  if (c.kind === "all") return { kind: "all", join: c.join };
  return { kind: "count" };
}
