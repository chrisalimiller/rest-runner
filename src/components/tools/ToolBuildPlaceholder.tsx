import type { Tool } from "../../lib/tools/types";

interface Props {
  tool: Tool;
}

/**
 * Build mode, until it is built. The Tools section swaps this component for the real editor (see ToolsApp, where
 * `mode === "build"` picks it); it is handed the open tool.
 */
export function ToolBuildPlaceholder({ tool }: Props) {
  return (
    <main className="tool-main tool-build-placeholder">
      <div>
        <h2>{tool.name || "(unnamed)"}</h2>
        <p className="muted">Build mode arrives in the next update.</p>
      </div>
    </main>
  );
}
