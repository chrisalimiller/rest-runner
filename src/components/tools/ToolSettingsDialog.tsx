import { useState } from "react";
import type { Environment } from "../../lib/environments";
import { addInput, parseOptions, removeInput, updateInput } from "../../lib/tools/builder";
import type { Tool, ToolInput } from "../../lib/tools/types";
import { TrashIcon } from "../shell/Icons";
import { Modal } from "../shell/Modal";

interface Props {
  tool: Tool;
  environments: Environment[];
  onChange: (tool: Tool) => void;
  onClose: () => void;
  /** Which part to start at. */
  focus?: "inputs" | "settings";
}

/** Tool-level settings in Build mode: name, description, inputs, and how lookups run. Edits go to the draft at once. */
export function ToolSettingsDialog({ tool, environments, onChange, onClose, focus = "settings" }: Props) {
  const names = tool.inputs.map((i) => i.name);
  const dupes = new Set(names.filter((n, i) => names.indexOf(n) !== i));
  return (
    <Modal label="Tool settings" onClose={onClose} className="tool-settings-dialog">
      <div className="modal-head">
        <h3>Tool settings</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="cd-body ts-body">
        <section className="ts-section" aria-label="About">
          <label className="field">
            Name
            <input type="text" value={tool.name} onChange={(e) => onChange({ ...tool, name: e.target.value })} autoFocus={focus === "settings"} />
          </label>
          <label className="field">
            Description
            <input type="text" value={tool.description} placeholder="What this tool is for" onChange={(e) => onChange({ ...tool, description: e.target.value })} />
          </label>
        </section>
        <section className="ts-section" aria-label="Inputs">
          <h4>Inputs</h4>
          <p className="small muted">What the person types or picks before pressing Look up. Requests can use an input wherever they have a placeholder.</p>
          {tool.inputs.length === 0 && <p className="muted small">No inputs yet.</p>}
          <ul className="ts-inputs">
            {tool.inputs.map((i, idx) => (
              <InputRow key={idx} input={i} duplicate={dupes.has(i.name)} autoFocus={focus === "inputs" && idx === 0} onChange={(patch) => onChange(updateInput(tool, i.name, patch))} onRemove={() => onChange(removeInput(tool, i.name))} />
            ))}
          </ul>
          <button type="button" className="secondary" onClick={() => onChange(addInput(tool).tool)}>
            Add input
          </button>
        </section>
        <section className="ts-section" aria-label="Lookups">
          <h4>Lookups</h4>
          <label className="field">
            Environment
            <select value={tool.settings.environmentId ?? ""} onChange={(e) => onChange({ ...tool, settings: { ...tool.settings, environmentId: e.target.value || null } })}>
              <option value="">No environment</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={tool.settings.runOnOpen} onChange={(e) => onChange({ ...tool, settings: { ...tool.settings, runOnOpen: e.target.checked } })} />
            <span>Look up when the tool is opened</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={tool.settings.keepHistory} onChange={(e) => onChange({ ...tool, settings: { ...tool.settings, keepHistory: e.target.checked } })} />
            <span>Keep recent lookups. Turning this off and saving removes the ones kept.</span>
          </label>
        </section>
      </div>
      <div className="modal-foot">
        <span className="muted small">Edits join your unsaved changes. Save the tool to keep them.</span>
        <button className="send" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function InputRow({ input, duplicate, autoFocus, onChange, onRemove }: { input: ToolInput; duplicate: boolean; autoFocus: boolean; onChange: (patch: Partial<ToolInput>) => void; onRemove: () => void }) {
  // The choices are typed one per line; the text is kept here so a half-typed line is not tidied away.
  const [options, setOptions] = useState((input.options ?? []).join("\n"));
  return (
    <li className="ts-input">
      <div className="ts-input-main">
        <label className="field small">
          Name
          <input type="text" className="mono" value={input.name} aria-invalid={duplicate || input.name.trim() === ""} onChange={(e) => onChange({ name: e.target.value })} spellCheck={false} autoFocus={autoFocus} />
        </label>
        <label className="field small">
          Label
          <input type="text" value={input.label} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
        <label className="field small">
          Type
          <select value={input.kind} onChange={(e) => onChange({ kind: e.target.value as ToolInput["kind"], ...(e.target.value === "dropdown" ? { options: parseOptions(options) } : {}) })}>
            <option value="text">Text</option>
            <option value="dropdown">Dropdown</option>
          </select>
        </label>
        <label className="field small">
          Default
          <input type="text" value={input.default ?? ""} onChange={(e) => onChange({ default: e.target.value })} />
        </label>
        <button type="button" className="icon-btn" aria-label={`Remove input ${input.name}`} title="Remove" onClick={onRemove}>
          <TrashIcon />
        </button>
      </div>
      {duplicate && <p className="small tone-bad">Another input has this name. Names must be different.</p>}
      {input.kind === "dropdown" && (
        <label className="field small">
          Choices, one per line
          <textarea
            rows={3}
            value={options}
            onChange={(e) => {
              setOptions(e.target.value);
              onChange({ options: parseOptions(e.target.value) });
            }}
          />
        </label>
      )}
    </li>
  );
}
