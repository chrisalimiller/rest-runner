import { useState } from "react";
import { callJson } from "../../lib/tools/engine";
import { addFoundList, addListByPath, addListTable, findLists, listOutline, pickHasNoTable, removeList, updateList, type FoundList, type ListNode } from "../../lib/tools/listBuilder";
import type { CallResult, Tool, ToolCall } from "../../lib/tools/types";
import { TrashIcon } from "../shell/Icons";
import { RuleEditor } from "./ListControls";

interface Props {
  tool: Tool;
  call: ToolCall;
  result: CallResult | undefined;
  onChange: (tool: Tool) => void;
}

/**
 * The Lists section of a call's options: the lists the sample response holds, each with its size and the rule that says which item
 * it hands on. Lists can be renamed; the text that names an item is guessed from the first item.
 */
export function ListsSection({ tool, call, result, onChange }: Props) {
  const json = result?.state === "done" ? callJson(result) : undefined;
  const found = findLists(json);
  const outline = listOutline(call, found);
  const [path, setPath] = useState("");
  const hasSample = result?.state === "done";

  const add = (f: FoundList, parent?: string) => onChange(addFoundList(tool, call.id, f, parent).tool);

  return (
    <div className="call-lists" role="group" aria-label={`Lists in ${call.name}`}>
      <h5>Lists</h5>
      {outline.nodes.length === 0 && outline.suggestions.length === 0 && (
        <p className="small muted">{hasSample ? "The sample response has no lists." : "Run with sample to find the lists in the response."}</p>
      )}
      {outline.nodes.length > 0 && (
        <ul className="list-tree">
          {outline.nodes.map((n) => (
            <ListItem key={n.list.id} tool={tool} call={call} node={n} onChange={onChange} onAdd={add} />
          ))}
        </ul>
      )}
      {outline.suggestions.length > 0 && (
        <div className="list-found">
          <span className="muted small">Found in the sample:</span>
          {outline.suggestions.map((f) => (
            <button key={f.path} type="button" className="link-btn small" onClick={() => add(f)} title={`Add the list at ${f.path}`}>
              + {f.name} ({f.size})
            </button>
          ))}
        </div>
      )}
      <form
        className="list-add-path"
        onSubmit={(e) => {
          e.preventDefault();
          const r = addListByPath(tool, call.id, path);
          if (r.list) {
            onChange(r.tool);
            setPath("");
          }
        }}
      >
        <input type="text" className="mono" value={path} placeholder="Or type a path, e.g. $.devices" aria-label={`Path of a list in ${call.name}`} spellCheck={false} onChange={(e) => setPath(e.target.value)} />
        <button type="submit" className="secondary" disabled={!path.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function ListItem({ tool, call, node, onChange, onAdd }: { tool: Tool; call: ToolCall; node: ListNode; onChange: (t: Tool) => void; onAdd: (f: FoundList, parent?: string) => void }) {
  const { list, found } = node;
  const patch = (p: Partial<typeof list>) => onChange(updateList(tool, call.id, list.id, p));
  const items = found ? [found.first] : [];
  return (
    <li className="list-card">
      <div className="list-head">
        <input className="list-name" type="text" value={list.name} aria-label="List name" onChange={(e) => patch({ name: e.target.value })} spellCheck={false} />
        <span className="muted small list-size" title={found ? `Read from ${list.path || "$"}` : "This path is not a list in the sample response"}>
          {found ? `${found.size} ${found.size === 1 ? "item" : "items"}` : "not in sample"}
        </span>
        <button type="button" className="icon-btn" aria-label={`Remove list ${list.name}`} title="Remove this list. Values that read it show as missing." onClick={() => onChange(removeList(tool, call.id, list.id))}>
          <TrashIcon />
        </button>
      </div>
      <div className="list-path mono small muted">{list.parentListId ? `in each item: ${list.path || "$"}` : list.path || "$"}</div>
      <div className="list-rule">
        <span className="small muted">Item to use</span>
        <RuleEditor ctx={{ tool, callId: call.id, items }} rule={list.choose} label={list.name} onChange={(choose) => patch({ choose })} />
      </div>
      {pickHasNoTable(tool, call, list.id) && (
        <p className="small tone-warn list-no-table" role="status">
          Nothing shows this list, so a lookup would wait for a row you cannot pick.{" "}
          <button type="button" className="link-btn small" onClick={() => onChange(addListTable(tool, call.id, list.id))}>
            Add a table for {list.name}
          </button>
        </p>
      )}
      <label className="field small list-label">
        Shown when choosing
        <input type="text" className="mono" value={list.labelPath} placeholder="$.name" aria-label={`Shown when choosing in ${list.name}`} spellCheck={false} onChange={(e) => patch({ labelPath: e.target.value })} />
      </label>
      {(node.children.length > 0 || node.suggestions.length > 0) && (
        <div className="list-inner">
          {node.children.length > 0 && (
            <ul className="list-tree">
              {node.children.map((c) => (
                <ListItem key={c.list.id} tool={tool} call={call} node={c} onChange={onChange} onAdd={onAdd} />
              ))}
            </ul>
          )}
          {node.suggestions.length > 0 && (
            <div className="list-found">
              <span className="muted small">Inside each {list.name.toLowerCase()} item:</span>
              {node.suggestions.map((f) => (
                <button key={f.path} type="button" className="link-btn small" onClick={() => onAdd(f, list.id)}>
                  + {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
