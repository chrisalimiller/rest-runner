import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleTool } from "../../lib/tools/sample";
import { ToolsSidebar } from "./ToolsSidebar";

const noop = () => {};
const tool = sampleTool();

function html(keepsHistory: boolean) {
  return renderToStaticMarkup(
    <ToolsSidebar collapsed={false} onToggleCollapsed={noop} tools={[tool]} activeToolId={tool.id} onOpenTool={noop} onNewTool={noop} runningToolIds={[]} recents={[]} activeRecordId={null} onOpenRecord={noop} onClearHistory={noop} onExport={noop} onImport={noop} keepsHistory={keepsHistory} onKeepHistory={noop} />,
  );
}

describe("Tools sidebar", () => {
  it("Import is a button, with the file input out of the tab order", () => {
    const out = html(true);
    expect(out).toContain('<button type="button" class="link-btn" title="Import tools from a file">Import</button>');
    expect(out).not.toContain("<label class=\"link-btn\"");
    expect(out).toContain('tabindex="-1"');
  });

  it("says in the sidebar when lookups are not kept", () => {
    expect(html(false)).toContain("Off: lookups aren&#x27;t kept.");
  });

  it("offers Recent in the narrow row", () => {
    expect(html(true)).toContain("tools-recent-menu");
  });
});
