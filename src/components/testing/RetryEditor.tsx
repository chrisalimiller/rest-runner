import { formatMs } from "../../lib/flows/flows";
import type { RetrySettings } from "../../lib/testing/types";

export function NumberField({ label, value, onChange, min = 0, suffix }: { label: string; value: number; onChange: (n: number) => void; min?: number; suffix?: string }) {
  return (
    <label className="flow-field">
      <span>{label}</span>
      <span className="flow-field-row">
        <input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || 0)))} />
        {suffix && <span className="muted small">{suffix}</span>}
      </span>
    </label>
  );
}

/** Retry settings for a Run step in Flows or a test case in Testing. */
export function RetryEditor({ retry, onChange, what = "step" }: { retry: RetrySettings; onChange: (r: RetrySettings) => void; what?: "step" | "case" }) {
  return (
    <fieldset className="flow-fieldset">
      <legend className="section-title">Retry</legend>
      <NumberField label="Extra tries" value={retry.times} onChange={(times) => onChange({ ...retry, times: Math.min(100, times) })} suffix={retry.times === 0 ? "off" : undefined} />
      {retry.times > 0 && <NumberField label="Wait between tries" value={retry.delayMs} onChange={(delayMs) => onChange({ ...retry, delayMs })} suffix={`ms (${formatMs(retry.delayMs)})`} />}
      <p className="muted small">When this {what} fails it is tried again, up to this many more times. Each try starts from the variables the {what} started with.</p>
    </fieldset>
  );
}
