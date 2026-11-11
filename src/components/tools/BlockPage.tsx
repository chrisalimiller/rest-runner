import { useEffect, useRef, useState } from "react";
import type { RequestLookup } from "../../lib/flows/flows";
import { blockLabel, filterBlockTypes, groupRows, moveBlock, rowHasRoom, stepBlock, type BlockStep, type DropTarget } from "../../lib/tools/builder";
import type { SessionState } from "../../lib/tools/session";
import type { BlockType, Tool, ToolBlock } from "../../lib/tools/types";
import { TrashIcon } from "../shell/Icons";
import { BlockCard, type BoardActions } from "./ToolBlocks";

/** What a dragged block carries. */
export const BLOCK_DRAG_TYPE = "application/x-rest-runner-block";

interface Props {
  tool: Tool;
  state: SessionState;
  findRequest: RequestLookup;
  actions: BoardActions;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Opens the Connect dialog for a block. */
  onConnect: (id: string) => void;
  onBlocks: (blocks: ToolBlock[]) => void;
  onAdd: (type: BlockType) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

interface Drag {
  id: string;
  target: DropTarget | null;
}

/** The block page in Build mode: rows of up to three blocks. Blocks move by their handle (drag), or with the arrow buttons. */
export function BlockPage({ tool, state, findRequest, actions, selectedId, onSelect, onConnect, onBlocks, onAdd, onDuplicate, onDelete }: Props) {
  const rows = groupRows(tool.blocks);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState("");

  const drop = (target: DropTarget) => {
    if (!drag) return;
    const next = moveBlock(tool.blocks, drag.id, target);
    setDrag(null);
    if (next !== tool.blocks) {
      onBlocks(next);
      setAnnounce(`Moved ${blockName(tool.blocks.find((b) => b.id === drag.id))}.`);
    }
  };
  const step = (id: string, s: BlockStep) => {
    const next = stepBlock(tool.blocks, id, s);
    if (next === tool.blocks) return;
    onBlocks(next);
    const moved = next.find((b) => b.id === id);
    const r = groupRows(next);
    const rowNo = moved ? moved.row + 1 : 0;
    const pos = moved ? r[moved.row].findIndex((b) => b.id === id) + 1 : 0;
    setAnnounce(`${blockName(moved)} is now in row ${rowNo} of ${r.length}, place ${pos} of ${r[moved?.row ?? 0]?.length ?? 1}.`);
  };

  const gap = (index: number) => {
    const target: DropTarget = { kind: "new-row", index };
    const active = drag?.target?.kind === "new-row" && drag.target.index === index;
    return (
      <div
        key={`gap-${index}`}
        className={`build-gap ${drag ? "armed" : ""} ${active ? "active" : ""}`}
        data-gap={index}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!(drag.target?.kind === "new-row" && drag.target.index === index)) setDrag({ ...drag, target });
        }}
        onDrop={(e) => {
          e.preventDefault();
          drop(target);
        }}
      >
        {drag && <span className="build-gap-label">{active ? "Drop to start a new row" : ""}</span>}
      </div>
    );
  };

  return (
    <div className={`build-page ${drag ? "dragging" : ""}`}>
      <div className="build-col-head">
        <h3>Page</h3>
        <span className="muted small">Up to 3 blocks per row. Drag a block by its handle, or use its arrows.</span>
      </div>
      <div className="build-page-scroll" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
        {rows.length === 0 && !drag && (
          <p className="muted build-empty">
            This page is empty. Type <kbd>/</kbd> below or press Add block to put the first block on it.
          </p>
        )}
        {gap(0)}
        {rows.map((row, ri) => (
          <div key={ri} className="build-row-wrap">
            <div className="tool-row build-row" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }} data-row={ri}>
              {row.map((b, bi) => (
                <BuildBlock
                  key={b.id}
                  block={b}
                  tool={tool}
                  state={state}
                  findRequest={findRequest}
                  actions={actions}
                  selected={selectedId === b.id}
                  dragging={drag?.id === b.id}
                  dropSide={drag && drag.target?.kind === "in-row" && drag.target.row === ri ? (drag.target.position === bi ? "before" : drag.target.position === bi + 1 ? "after" : null) : null}
                  onSelect={() => onSelect(b.id)}
                  onConnect={() => onConnect(b.id)}
                  onDelete={() => onDelete(b.id)}
                  onDuplicate={() => onDuplicate(b.id)}
                  onStep={(s) => step(b.id, s)}
                  onDragStart={() => setDrag({ id: b.id, target: null })}
                  onDragEnd={() => setDrag(null)}
                  onOver={(side) => {
                    if (!drag) return false;
                    if (drag.id === b.id || !rowHasRoom(tool.blocks, ri, drag.id)) return false;
                    const position = side === "before" ? bi : bi + 1;
                    if (!(drag.target?.kind === "in-row" && drag.target.row === ri && drag.target.position === position)) setDrag({ ...drag, target: { kind: "in-row", row: ri, position } });
                    return true;
                  }}
                  onDrop={() => drag?.target && drop(drag.target)}
                  canStep={{
                    up: ri > 0 || row.length > 1,
                    down: ri < rows.length - 1 || row.length > 1,
                    left: bi > 0,
                    right: bi < row.length - 1,
                  }}
                />
              ))}
            </div>
            {gap(ri + 1)}
          </div>
        ))}
        <AddBlockBar onAdd={onAdd} />
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

function blockName(b: ToolBlock | undefined): string {
  if (!b) return "Block";
  return b.title || blockLabel(b.type);
}

interface BuildBlockProps {
  block: ToolBlock;
  tool: Tool;
  state: SessionState;
  findRequest: RequestLookup;
  actions: BoardActions;
  selected: boolean;
  dragging: boolean;
  dropSide: "before" | "after" | null;
  canStep: Record<BlockStep, boolean>;
  onSelect: () => void;
  onConnect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onStep: (s: BlockStep) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Reports the side the pointer is on. Returns false when the block cannot take the drop. */
  onOver: (side: "before" | "after") => boolean;
  onDrop: () => void;
}

const STEP_LABELS: Record<BlockStep, string> = { up: "Move up", down: "Move down", left: "Move left", right: "Move right" };
const STEP_GLYPHS: Record<BlockStep, string> = { up: "↑", down: "↓", left: "←", right: "→" };

function BuildBlock(p: BuildBlockProps) {
  const name = blockName(p.block);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`build-block ${p.selected ? "selected" : ""} ${p.dragging ? "is-dragging" : ""} ${p.dropSide ? `drop-${p.dropSide}` : ""}`}
      data-block-id={p.block.id}
      tabIndex={0}
      role="group"
      aria-label={`${blockLabel(p.block.type)} block: ${name}`}
      onClick={(e) => {
        // Clicks on the block's own buttons and fields do their own thing.
        if ((e.target as HTMLElement).closest("button, a, input, select, textarea, summary, label, [role=menu]")) return;
        p.onSelect();
        p.onConnect();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          e.preventDefault();
          p.onSelect();
          p.onConnect();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          p.onDelete();
        }
      }}
      onDragOver={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        if (p.onOver(e.clientX < r.left + r.width / 2 ? "before" : "after")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        p.onDrop();
      }}
    >
      <div className="build-chrome">
        <span
          className="build-handle"
          role="button"
          tabIndex={0}
          draggable
          aria-label={`Move ${name}. Drag, or press an arrow key`}
          title="Drag to move this block"
          onDragStart={(e) => {
            e.dataTransfer.setData(BLOCK_DRAG_TYPE, p.block.id);
            e.dataTransfer.effectAllowed = "move";
            // The whole block follows the pointer, not just the grip.
            if (ref.current) e.dataTransfer.setDragImage(ref.current, 16, 12);
            p.onDragStart();
          }}
          onDragEnd={p.onDragEnd}
          onKeyDown={(e) => {
            const map: Record<string, BlockStep> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
            const s = map[e.key];
            if (s) {
              e.preventDefault();
              if (p.canStep[s]) p.onStep(s);
            }
          }}
        >
          <span aria-hidden="true">⠿</span>
        </span>
        <span className="build-kind">{blockLabel(p.block.type)}</span>
        <span className="flex-gap" />
        {(["left", "right", "up", "down"] as BlockStep[]).map((s) => (
          <button key={s} type="button" className="icon-btn build-step" disabled={!p.canStep[s]} aria-label={`${STEP_LABELS[s]}: ${name}`} title={STEP_LABELS[s]} onClick={() => p.onStep(s)}>
            {STEP_GLYPHS[s]}
          </button>
        ))}
        <button type="button" className="secondary build-connect" onClick={() => (p.onSelect(), p.onConnect())} aria-label={`Connect ${name}`}>
          Connect…
        </button>
        <button type="button" className="icon-btn" onClick={p.onDuplicate} aria-label={`Duplicate ${name}`} title="Duplicate">
          ⧉
        </button>
        <button type="button" className="icon-btn" onClick={p.onDelete} aria-label={`Delete ${name}`} title="Delete">
          <TrashIcon />
        </button>
      </div>
      <div className="build-block-body">
        <BlockCard block={p.block} tool={p.tool} state={p.state} findRequest={p.findRequest} actions={p.actions} />
      </div>
    </div>
  );
}

/** The line under the page: type "/" (or press Add block) to choose a block. */
function AddBlockBar({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const slash = text.startsWith("/");
  const list = filterBlockTypes(slash ? text : "");
  const shown = open || slash;

  useEffect(() => setActive(0), [text]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (type: BlockType) => {
    setText("");
    setOpen(false);
    onAdd(type);
  };

  return (
    <div className="add-block" ref={wrap}>
      <div className="add-block-bar">
        <input
          ref={input}
          type="text"
          value={text}
          placeholder="Type / to add a block"
          aria-label="Add a block: type a slash, then the block's name"
          role="combobox"
          aria-expanded={shown}
          aria-controls="add-block-list"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && shown) {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === "ArrowUp" && shown) {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && shown && list[active]) {
              e.preventDefault();
              choose(list[active].type);
            } else if (e.key === "Escape") {
              setText("");
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open) input.current?.focus();
          }}
        >
          Add block
        </button>
      </div>
      {shown && (
        <ul id="add-block-list" className="add-block-list" role="listbox" aria-label="Blocks">
          {list.map((b, i) => (
            <li key={b.type} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onClick={() => choose(b.type)}>
                <span className="add-block-name">{b.label}</span>
                <span className="muted small">{b.hint}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="muted small add-block-none">No block called “{text.replace(/^\//, "")}”.</li>}
        </ul>
      )}
    </div>
  );
}
