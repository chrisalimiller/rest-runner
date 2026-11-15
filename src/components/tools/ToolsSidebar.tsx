import { useEffect, useRef, useState } from "react";
import { whenLabel } from "../../lib/earlierSends";
import type { LookupRecord, Tool } from "../../lib/tools/types";
import { inputsSummary } from "../../lib/tools/view";
import { CollapseIcon } from "../shell/Icons";
import { ImportButton } from "../shell/ImportButton";

interface Props {
  /** The list is folded to a thin rail; the choice is remembered. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  tools: Tool[];
  activeToolId: string | null;
  onOpenTool: (id: string) => void;
  onNewTool: () => void;
  runningToolIds: string[];
  /** The open tool's saved lookups, newest first. */
  recents: LookupRecord[];
  /** The saved lookup on screen. */
  activeRecordId: string | null;
  onOpenRecord: (record: LookupRecord) => void;
  onClearHistory: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  keepsHistory: boolean;
  onKeepHistory: (keep: boolean) => void;
}

/** Tools and the open tool's recent lookups on the left of Tools mode. Below 1100px wide (where the Requests sidebar floats too) it turns into a row at the top, with Recent lookups in a menu. */
export function ToolsSidebar({ collapsed, onToggleCollapsed, tools, activeToolId, onOpenTool, onNewTool, runningToolIds, recents, activeRecordId, onOpenRecord, onClearHistory, onExport, onImport, keepsHistory, onKeepHistory }: Props) {
  const importLink = <ImportButton title="Import tools from a file" onImport={onImport} />;
  const [recentOpen, setRecentOpen] = useState(false);
  const recentBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!recentOpen) return;
    const away = (e: MouseEvent) => {
      if (!recentBox.current?.contains(e.target as Node)) setRecentOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRecentOpen(false);
        recentBox.current?.querySelector<HTMLButtonElement>(".recent-toggle")?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [recentOpen]);

  const keepSwitch = (id: string) => (
    <div className="tool-keep-wrap">
      <label className="tool-keep small muted">
        <input type="checkbox" checked={keepsHistory} onChange={(e) => onKeepHistory(e.target.checked)} aria-describedby={id} />
        Keep recent lookups
      </label>
      <p className="tool-keep-hint small muted" id={id}>
        {keepsHistory ? "The last 20 lookups are kept on this computer." : "Off: lookups aren't kept."}
      </p>
    </div>
  );
  const recentRows = (after?: () => void) =>
    recents.map((r) => (
      <button
        key={r.id}
        className={`nav-row run-row ${activeRecordId === r.id ? "active" : ""}`}
        aria-current={activeRecordId === r.id ? "true" : undefined}
        onClick={() => {
          onOpenRecord(r);
          after?.();
        }}
        title={`${new Date(r.startedAt).toLocaleString()}${r.environmentName ? ` · ${r.environmentName}` : ""}`}
      >
        <span className="nav-row-name">{inputsSummary(r.inputs) || "(no inputs)"}</span>
        <span className="muted">{whenLabel(r.startedAt)}</span>
      </button>
    ));
  const exportLink = (
    <button className="link-btn" onClick={onExport} title="Save every tool, with the saved requests they use, to a file">
      Export
    </button>
  );
  return (
    <>
      <div className="runbook-nav-compact">
        <select value={activeToolId ?? ""} onChange={(e) => e.target.value && onOpenTool(e.target.value)} aria-label="Tool">
          {!activeToolId && <option value="">Pick a tool…</option>}
          {tools.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || "(unnamed)"}
            </option>
          ))}
        </select>
        <button className="link-btn small" onClick={onNewTool}>
          New
        </button>
        {importLink}
        {tools.length > 0 && exportLink}
        {activeToolId && (
          <div className="tools-recent-menu" ref={recentBox}>
            <button className="link-btn recent-toggle" aria-expanded={recentOpen} aria-haspopup="true" onClick={() => setRecentOpen((o) => !o)}>
              Recent{recents.length > 0 ? ` (${recents.length})` : ""}
            </button>
            {recentOpen && (
              <div className="tools-recent-panel" role="group" aria-label="Recent lookups">
                {keepSwitch("tool-keep-hint-compact")}
                {recents.length === 0 && <p className="muted small nav-empty">{keepsHistory ? "Lookups you run show up here." : "This tool keeps no history."}</p>}
                {recentRows(() => setRecentOpen(false))}
                {recents.length > 0 && (
                  <button
                    className="link-btn tools-recent-clear"
                    onClick={() => {
                      onClearHistory();
                      setRecentOpen(false);
                    }}
                  >
                    Clear history
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {collapsed && (
        <nav className="runbook-nav collapsed" aria-label="Tools and recent lookups">
          <button className="icon-btn" onClick={onToggleCollapsed} aria-label="Show tools and recent lookups" title="Show the list" aria-expanded={false}>
            <CollapseIcon expand />
          </button>
        </nav>
      )}
      <nav className="runbook-nav" aria-label="Tools and recent lookups" hidden={collapsed}>
        <div className="nav-group">
          <div className="nav-group-head">
            <span className="section-title">Tools</span>
            <span className="sidebar-actions">
              <button className="link-btn" onClick={onNewTool} title="Add a tool">
                New
              </button>
              {importLink}
              {tools.length > 0 && exportLink}
              <button className="icon-btn" onClick={onToggleCollapsed} aria-label="Hide the list" title="Hide the list" aria-expanded>
                <CollapseIcon />
              </button>
            </span>
          </div>
          {tools.length === 0 && <p className="muted small nav-empty">A tool is a small lookup page: type an ID, see the answers from several requests.</p>}
          {tools.map((t) => (
            <button
              key={t.id}
              className={`nav-row ${activeToolId === t.id ? "active" : ""}`}
              aria-current={activeToolId === t.id ? "page" : undefined}
              onClick={() => onOpenTool(t.id)}
              title={t.description || t.name}
            >
              {runningToolIds.includes(t.id) && <span className="pulse-dot" aria-label="Running" />}
              <span className="nav-row-name">{t.name || "(unnamed)"}</span>
            </button>
          ))}
        </div>
        {activeToolId && (
          <div className="nav-group">
            <div className="nav-group-head">
              <span className="section-title">Recent lookups</span>
              {recents.length > 0 && (
                <span className="sidebar-actions">
                  <button className="link-btn" onClick={onClearHistory} title="Remove this tool's saved lookups">
                    Clear history
                  </button>
                </span>
              )}
            </div>
            {recents.length === 0 && <p className="muted small nav-empty">{keepsHistory ? "Lookups you run show up here." : "This tool keeps no history."}</p>}
            {keepSwitch("tool-keep-hint")}
            {recentRows()}
          </div>
        )}
      </nav>
    </>
  );
}
