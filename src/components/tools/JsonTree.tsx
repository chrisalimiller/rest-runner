import { useMemo, useState } from "react";
import { buildTree, type TreeNode } from "../../lib/tools/builder";

interface Props {
  /** The sample response (or one row of it). */
  sample: unknown;
  /** Whether a path is already picked. */
  isPicked: (path: string) => boolean;
  /** A click on a value. */
  onPick: (path: string) => void;
  /** Name of the whole sample in the first line. */
  rootLabel?: string;
  /** Whether the whole sample can be picked (a JSON block, or a pick-a-row list). */
  rootPickable?: boolean;
  /** Names the first line for a screen reader, e.g. "Pick the fields to show". */
  label: string;
}

/** A sample response as a tree. Click a value to pick it; the paths it produces are the ones readPath reads. */
export function JsonTree({ sample, isPicked, onPick, rootLabel = "Whole response", rootPickable = false, label }: Props) {
  const root = useMemo(() => buildTree(sample), [sample]);
  return (
    <div className="json-tree" role="tree" aria-label={label}>
      <TreeRow node={root} depth={0} isPicked={isPicked} onPick={onPick} rootLabel={rootLabel} rootPickable={rootPickable} />
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  isPicked: (path: string) => boolean;
  onPick: (path: string) => void;
  rootLabel: string;
  rootPickable: boolean;
}

function TreeRow({ node, depth, isPicked, onPick, rootLabel, rootPickable }: RowProps) {
  const [open, setOpen] = useState(depth < 2);
  const branch = node.kind === "object" || node.kind === "array";
  const isRoot = depth === 0;
  const pickable = node.pickable && (!isRoot || rootPickable || !branch);
  const picked = pickable && isPicked(node.path);
  const name = isRoot ? rootLabel : node.key;
  const hidden = node.kind === "array" && node.total !== undefined && node.total > node.children.length ? node.total - node.children.length : 0;
  return (
    <div role="treeitem" aria-expanded={branch ? open : undefined} aria-selected={picked} className="json-node">
      <div className={`json-line ${picked ? "picked" : ""}`} style={{ paddingLeft: depth * 14 }}>
        {branch ? (
          <button type="button" className="json-twisty" onClick={() => setOpen(!open)} aria-label={open ? `Collapse ${name}` : `Expand ${name}`}>
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span className="json-twisty" aria-hidden="true" />
        )}
        <button
          type="button"
          className="json-pick"
          disabled={!pickable}
          onClick={() => onPick(node.path)}
          title={pickable ? `${picked ? "Remove" : "Use"} ${node.path}` : node.pickable ? "Open it to pick a value inside" : "This name cannot be written as a path"}
          data-path={node.path}
        >
          <span className="json-key">{name}</span>
          <span className={`json-val kind-${node.kind}`}>{node.preview}</span>
          {picked && (
            <span className="json-check" aria-hidden="true">
              ✓
            </span>
          )}
        </button>
      </div>
      {branch && open && (
        <div role="group">
          {node.children.map((c) => (
            <TreeRow key={`${c.path}:${c.key}`} node={c} depth={depth + 1} isPicked={isPicked} onPick={onPick} rootLabel={rootLabel} rootPickable={rootPickable} />
          ))}
          {hidden > 0 && (
            <div className="json-more muted small" style={{ paddingLeft: (depth + 1) * 14 + 22 }}>
              {hidden} more like these
            </div>
          )}
        </div>
      )}
    </div>
  );
}
