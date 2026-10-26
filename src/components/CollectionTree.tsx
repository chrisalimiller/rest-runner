import { useEffect, useRef, useState } from "react";
import { useEscape } from "./useEscape";
import {
  countRequests,
  type Collection,
  type Destination,
  type FolderNode,
  type RequestExample,
  type RequestNode,
  type TreeNode,
} from "../lib/collections";

export type TreeAction =
  | { type: "new-request"; dest: Destination }
  | { type: "new-folder"; dest: Destination }
  | { type: "add-example"; requestId: string }
  | { type: "rename"; id: string; name: string }
  | { type: "duplicate"; id: string }
  | { type: "move"; id: string }
  | { type: "delete"; id: string; label: string };

interface Props {
  collections: Collection[];
  activeId: string | null;
  expanded: Set<string>;
  onToggle: (id: string, open?: boolean) => void;
  renamingId: string | null;
  onRenamingChange: (id: string | null) => void;
  onOpenRequest: (node: RequestNode) => void;
  onOpenExample: (node: RequestNode, example: RequestExample) => void;
  onAction: (action: TreeAction) => void;
}

interface MenuItem {
  label: string;
  danger?: boolean;
  run: () => void;
}

/** The sidebar tree of collections, folders, requests and their examples. */
export function CollectionTree(props: Props) {
  const { collections, expanded, onToggle, onAction, renamingId, onRenamingChange } = props;
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; items: MenuItem[] } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEscape(() => setMenu(null), menu !== null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const openMenu = (e: React.MouseEvent, id: string, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.type === "contextmenu" ? e.clientX : rect.right - 4;
    const y = e.type === "contextmenu" ? e.clientY : rect.bottom + 2;
    setMenu({ id, x, y, items });
  };

  const run = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  const containerItems = (dest: Destination, id: string): MenuItem[] => [
    { label: "New request", run: run(() => onAction({ type: "new-request", dest })) },
    { label: "New folder", run: run(() => onAction({ type: "new-folder", dest })) },
    { label: "Rename", run: run(() => onRenamingChange(id)) },
  ];

  const renameInput = (id: string, current: string) => (
    <RenameInput
      initial={current}
      onDone={(name) => {
        onRenamingChange(null);
        if (name !== null && name.trim() !== "" && name !== current) onAction({ type: "rename", id, name: name.trim() });
      }}
    />
  );

  const renderNodes = (collectionId: string, items: TreeNode[], depth: number) =>
    items.map((item) =>
      item.kind === "folder"
        ? renderFolder(collectionId, item, depth)
        : renderRequest(item, depth),
    );

  const renderFolder = (collectionId: string, folder: FolderNode, depth: number) => {
    const open = expanded.has(folder.id);
    const menuItems: MenuItem[] = [
      ...containerItems({ collectionId, folderId: folder.id }, folder.id),
      { label: "Duplicate", run: run(() => onAction({ type: "duplicate", id: folder.id })) },
      { label: "Move to…", run: run(() => onAction({ type: "move", id: folder.id })) },
      { label: "Delete", danger: true, run: run(() => onAction({ type: "delete", id: folder.id, label: `the folder "${folder.name}" and everything in it` })) },
    ];
    return (
      <li key={folder.id}>
        <div className={`tree-row ${menu?.id === folder.id ? "menu-open" : ""}`} style={indent(depth)} onContextMenu={(e) => openMenu(e, folder.id, menuItems)}>
          {renamingId === folder.id ? (
            <span className="tree-main">
              <Chevron open={open} />
              <FolderIcon />
              {renameInput(folder.id, folder.name)}
            </span>
          ) : (
            <button className="tree-main" onClick={() => onToggle(folder.id)} title={folder.name}>
              <Chevron open={open} />
              <FolderIcon />
              <span className="tree-label">{folder.name}</span>
            </button>
          )}
          <MenuButton label={folder.name} onClick={(e) => openMenu(e, folder.id, menuItems)} />
        </div>
        {open && (
          <ul className="tree">
            {renderNodes(collectionId, folder.items, depth + 1)}
            {folder.items.length === 0 && (
              <li className="tree-empty muted small" style={indent(depth + 1)}>
                Empty folder
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const renderRequest = (node: RequestNode, depth: number) => {
    const r = node.request;
    const open = expanded.has(node.id);
    const hasExamples = node.examples.length > 0;
    const menuItems: MenuItem[] = [
      { label: "Add example", run: run(() => onAction({ type: "add-example", requestId: node.id })) },
      { label: "Duplicate", run: run(() => onAction({ type: "duplicate", id: node.id })) },
      { label: "Rename", run: run(() => onRenamingChange(node.id)) },
      { label: "Move to…", run: run(() => onAction({ type: "move", id: node.id })) },
      { label: "Delete", danger: true, run: run(() => onAction({ type: "delete", id: node.id, label: `the request "${r.name}"${hasExamples ? " and its examples" : ""}` })) },
    ];
    return (
      <li key={node.id}>
        <div
          className={`tree-row ${props.activeId === node.id ? "active" : ""} ${menu?.id === node.id ? "menu-open" : ""}`}
          style={indent(depth)}
          onContextMenu={(e) => openMenu(e, node.id, menuItems)}
        >
          <button
            className={`tree-toggle ${hasExamples ? "" : "invisible"}`}
            onClick={() => onToggle(node.id)}
            aria-label={open ? "Hide examples" : "Show examples"}
            tabIndex={hasExamples ? 0 : -1}
          >
            <Chevron open={open} />
          </button>
          {renamingId === node.id ? (
            <span className="tree-main">
              <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
              {renameInput(node.id, r.name)}
            </span>
          ) : (
            <button className="tree-main" onClick={() => props.onOpenRequest(node)} title={r.url || r.name}>
              <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
              <span className="tree-label">{r.name}</span>
              {hasExamples && <span className="tree-count">{node.examples.length}</span>}
            </button>
          )}
          <MenuButton label={r.name} onClick={(e) => openMenu(e, node.id, menuItems)} />
        </div>
        {open && hasExamples && (
          <ul className="tree">
            {node.examples.map((ex) => {
              const exItems: MenuItem[] = [
                { label: "Rename", run: run(() => onRenamingChange(ex.id)) },
                { label: "Duplicate", run: run(() => onAction({ type: "duplicate", id: ex.id })) },
                { label: "Delete", danger: true, run: run(() => onAction({ type: "delete", id: ex.id, label: `the example "${ex.name}"` })) },
              ];
              return (
                <li key={ex.id}>
                  <div
                    className={`tree-row example ${props.activeId === ex.id ? "active" : ""} ${menu?.id === ex.id ? "menu-open" : ""}`}
                    style={indent(depth + 1)}
                    onContextMenu={(e) => openMenu(e, ex.id, exItems)}
                  >
                    {renamingId === ex.id ? (
                      <span className="tree-main">
                        <ExampleIcon />
                        {renameInput(ex.id, ex.name)}
                      </span>
                    ) : (
                      <button className="tree-main" onClick={() => props.onOpenExample(node, ex)} title={`Example of ${r.name}`}>
                        <ExampleIcon />
                        <span className="tree-label">{ex.name}</span>
                        {ex.response && <span className={`tree-status s${String(ex.response.status)[0]}`}>{ex.response.status}</span>}
                      </button>
                    )}
                    <MenuButton label={ex.name} onClick={(e) => openMenu(e, ex.id, exItems)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      <ul className="tree root">
        {collections.map((c) => {
          const open = expanded.has(c.id);
          const menuItems: MenuItem[] = [
            ...containerItems({ collectionId: c.id, folderId: null }, c.id),
            { label: "Delete", danger: true, run: run(() => onAction({ type: "delete", id: c.id, label: `the collection "${c.name}" and everything in it` })) },
          ];
          return (
            <li key={c.id}>
              <div className={`tree-row collection ${menu?.id === c.id ? "menu-open" : ""}`} onContextMenu={(e) => openMenu(e, c.id, menuItems)}>
                {renamingId === c.id ? (
                  <span className="tree-main">
                    <Chevron open={open} />
                    {renameInput(c.id, c.name)}
                  </span>
                ) : (
                  <button className="tree-main" onClick={() => onToggle(c.id)} title={c.name}>
                    <Chevron open={open} />
                    <span className="tree-label">{c.name}</span>
                    <span className="tree-count">{countRequests(c.items)}</span>
                  </button>
                )}
                <MenuButton label={c.name} onClick={(e) => openMenu(e, c.id, menuItems)} />
              </div>
              {open && (
                <ul className="tree">
                  {renderNodes(c.id, c.items, 1)}
                  {c.items.length === 0 && (
                    <li className="tree-empty small" style={indent(1)}>
                      <button className="link-btn" onClick={() => onAction({ type: "new-request", dest: { collectionId: c.id, folderId: null } })}>
                        Add a request
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {menu && (
        <div ref={menuRef} className="menu" style={{ left: Math.min(menu.x, window.innerWidth - 170), top: Math.min(menu.y, window.innerHeight - 40 * menu.items.length) }} role="menu">
          {menu.items.map((m) => (
            <button key={m.label} className={m.danger ? "danger" : ""} onClick={m.run} role="menuitem">
              {m.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function indent(depth: number): React.CSSProperties {
  return { paddingLeft: depth * 12 };
}

function MenuButton({ label, onClick }: { label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button className="icon-btn tree-menu-btn" aria-label={`Actions for ${label}`} title="More actions" onClick={onClick}>
      ⋯
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chevron ${open ? "open" : ""}`} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="tree-icon folder-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"
      />
    </svg>
  );
}

function ExampleIcon() {
  return (
    <svg className="tree-icon example-icon" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z"
      />
    </svg>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="tree-rename"
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      aria-label="New name"
    />
  );
}
