import { runsOnEnter } from "../../lib/tools/view";
import type { ToolInput } from "../../lib/tools/types";

interface Props {
  input: ToolInput;
  value: string;
  onChange: (value: string) => void;
  /** Enter in the text box runs the lookup. */
  onEnter: () => void;
  disabled?: boolean;
}

/** One input of a tool: a text box or a dropdown, showing the default when empty. */
export function InputControl({ input, value, onChange, onEnter, disabled }: Props) {
  const label = input.label || input.name;
  if (input.kind === "dropdown") {
    const options = input.options ?? [];
    return (
      <label className="tool-input">
        <span className="tool-input-label">{label}</span>
        <select value={value || input.default || options[0] || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="tool-input">
      <span className="tool-input-label">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={input.default ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (runsOnEnter({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing })) {
            e.preventDefault();
            onEnter();
          }
        }}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
