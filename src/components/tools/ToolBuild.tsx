import { useState } from "react";
import type { Environment } from "../../lib/environments";
import type { RequestLookup } from "../../lib/flows/flows";
import { newId } from "../../lib/ids";
import { addBlock, blankBlock, deleteBlock, duplicateBlock, saveBlockers } from "../../lib/tools/builder";
import type { SessionState } from "../../lib/tools/session";
import type { BlockType, Tool, ToolBlock } from "../../lib/tools/types";
import { progressCounts } from "../../lib/tools/view";
import { BlockPage } from "./BlockPage";
import { CallsColumn } from "./CallsColumn";
import { ConnectDialog, type ConnectTarget } from "./ConnectDialog";
import { InputControl } from "./InputControl";
import { ToolSettingsDialog } from "./ToolSettingsDialog";
import type { BoardActions } from "./ToolBlocks";
import "./toolBuild.css";

interface Props {
  /** The tool being edited: the draft, or the saved tool when nothing was changed. */
  tool: Tool;
  dirty: boolean;
  findRequest: RequestLookup;
  environments: Environment[];
  /** The Build mode session: sample input values and the answers of Run with sample. */
  state: SessionState;
  onChange: (tool: Tool) => void;
  onSave: () => void;
  onDiscard: () => void;
  onRunSample: (tool: Tool) => void;
  onStop: () => void;
  actions: Omit<BoardActions, "onRunKey" | "onRetry">;
}

/**
 * Build mode: a Calls list next to the block page. Edits go to a draft (see ToolsApp) and are kept by Save.
 * Run with sample runs the lookup with the sample inputs typed here, so every block fills with a real answer and
 * the Connect dialog can offer them to click.
 */
export function ToolBuild({ tool, dirty, findRequest, environments, state, onChange, onSave, onDiscard, onRunSample, onStop, actions }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [connect, setConnect] = useState<ConnectTarget | null>(null);
  const [settings, setSettings] = useState<"inputs" | "settings" | null>(null);

  const blockers = saveBlockers(tool, findRequest);
  const counts = progressCounts(tool, state.results, state.sending);
  const hasAny = Object.keys(state.results).length > 0 || state.running;
  const shownInInputBlocks = new Set(tool.blocks.filter((b) => b.type === "input").map((b) => b.inputName));
  const barInputs = tool.inputs.filter((i) => !shownInInputBlocks.has(i.name));
  const run = () => onRunSample(tool);
  const boardActions: BoardActions = { ...actions, onRunKey: run, onRetry: run };
  const noCalls = tool.calls.filter((c) => !c.write).length === 0;

  const setBlocks = (blocks: ToolBlock[]) => onChange({ ...tool, blocks });
  const addBlockOfType = (type: BlockType) => {
    const block = blankBlock(tool, type);
    onChange({ ...tool, blocks: addBlock(tool.blocks, block) });
    setSelected(block.id);
    setConnect({ blockId: block.id });
  };

  return (
    <main className="tool-main tool-build">
      <div className="tool-head build-head">
        <div className="tool-title">
          <h2>{tool.name || "(unnamed)"}</h2>
          {tool.description && <p className="muted small">{tool.description}</p>}
        </div>
        <div className="build-actions">
          {dirty && (
            <span className="build-dirty small" role="status">
              Unsaved changes
            </span>
          )}
          <button type="button" className="secondary" onClick={() => setSettings("settings")}>
            Settings
          </button>
          <button type="button" className="secondary" onClick={onDiscard} disabled={!dirty}>
            Discard
          </button>
          <button type="button" className="send" onClick={onSave} disabled={!dirty || blockers.length > 0} title={blockers[0]?.message ?? (dirty ? "Keep this tool" : "Nothing to save")}>
            Save
          </button>
        </div>
      </div>
      {blockers.length > 0 && (
        <ul className="build-problems" role="alert">
          {blockers.map((p, i) => (
            <li key={i} className="tone-bad">
              {p.message} {p.code === "cycle" ? "This tool cannot be saved until that is fixed." : "Fix it to save."}
            </li>
          ))}
        </ul>
      )}
      <form
        className="tool-inputs build-sample"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        aria-label="Run with sample"
      >
        {barInputs.map((i) => (
          <InputControl key={i.name} input={i} value={state.inputs[i.name] ?? ""} onChange={(v) => actions.onInput(i.name, v)} onEnter={run} />
        ))}
        <button type="submit" className="send tool-lookup" disabled={state.running || blockers.length > 0 || noCalls} title={blockers[0]?.message ?? (noCalls ? "Add a lookup request first" : "Sends this tool's lookup requests with the sample values and fills every block")}>
          Run with sample
        </button>
        {state.running && (
          <button type="button" className="send cancel" onClick={onStop}>
            Stop
          </button>
        )}
        <span className="muted small build-sample-note" role="status">
          {state.running
            ? state.pending.length > 0
              ? "Waiting for you to pick a row in the table, or press Stop."
              : "Running…"
            : hasAny
              ? `${counts.done} of ${counts.total} calls done${state.stopped ? " · stopped" : ""}. Write calls are never sent from here.`
              : "Sample values are only for building. Nothing is saved with the tool."}
        </span>
      </form>
      {state.error && (
        <p className="tool-error tone-bad" role="alert">
          {state.error}
        </p>
      )}
      <div className="build-body">
        <CallsColumn
          tool={tool}
          findRequest={findRequest}
          results={state.results}
          onChange={onChange}
          onEditInputs={() => setSettings("inputs")}
          onFillIn={(callId) => setConnect({ callId })}
          onOpenRequest={actions.onOpenRequest}
        />
        <BlockPage
          tool={tool}
          state={state}
          findRequest={findRequest}
          actions={boardActions}
          selectedId={selected}
          onSelect={setSelected}
          onConnect={(id) => setConnect({ blockId: id })}
          onBlocks={setBlocks}
          onAdd={addBlockOfType}
          onDuplicate={(id) => onChange({ ...tool, blocks: duplicateBlock(tool.blocks, id, newId()) })}
          onDelete={(id) => {
            onChange({ ...tool, blocks: deleteBlock(tool.blocks, id) });
            if (selected === id) setSelected(null);
          }}
        />
      </div>
      {connect && (
        <ConnectDialog
          tool={tool}
          target={connect}
          findRequest={findRequest}
          state={state}
          onRunSample={onRunSample}
          onStop={onStop}
          onCancel={() => setConnect(null)}
          onDone={(next) => {
            onChange(next);
            setConnect(null);
          }}
        />
      )}
      {settings && <ToolSettingsDialog tool={tool} environments={environments} focus={settings} onChange={onChange} onClose={() => setSettings(null)} />}
    </main>
  );
}
