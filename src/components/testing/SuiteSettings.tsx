import { CsvPreview } from "../CsvPreview";
import { useMemo, useRef, useState } from "react";
import { parseCsv } from "../../lib/csv";
import { requestPlaceholders } from "../../lib/request";
import { planIterations } from "../../lib/testing/runner";
import type { RunMode, SuiteRunOptions, TestSuite } from "../../lib/testing/types";

interface Props {
  suite: TestSuite;
  onChange: (suite: TestSuite) => void;
  envVarNames: string[];
}

/** CSV files above this size are used for the next run but not saved with the suite. */
export const MAX_SAVED_CSV = 2 * 1024 * 1024;

const MODES: { value: RunMode; label: string; help: string }[] = [
  { value: "sequential", label: "Sequential", help: "One case at a time, in order. Variables set by a case carry to the next case in the same iteration." },
  {
    value: "parallel-iterations",
    label: "Iterations in parallel",
    help: "Several CSV rows (or repeats) run at once. Inside each, cases still run in order and share variables.",
  },
  { value: "parallel-cases", label: "Cases in parallel", help: "All cases of an iteration start together. Cases cannot pass variables to each other in this mode." },
];

export function SuiteSettings({ suite, onChange, envVarNames }: Props) {
  const o = suite.options;
  const set = (p: Partial<SuiteRunOptions>) => onChange({ ...suite, options: { ...o, ...p } });
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const csv = useMemo(() => (suite.data ? parseCsv(suite.data.text) : null), [suite.data]);
  const enabled = suite.cases.filter((c) => c.enabled);
  const iterations = planIterations(csv?.rows ?? null, o.repeat).length;

  const used = useMemo(() => [...new Set(enabled.flatMap((c) => requestPlaceholders(c.request)))].sort(), [enabled]);
  const known = new Set([...(csv?.headers ?? []), ...envVarNames]);
  const fromScripts = (name: string) => enabled.some((c) => c.preScript.includes(name) || c.postScript.includes(name));

  const loadFile = async (file: File) => {
    setFileError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0) {
      setFileError(`${file.name} has no header row.`);
      return;
    }
    if (text.length > MAX_SAVED_CSV) setFileError(`${file.name} is large; it is kept for this session but may not be saved with the suite.`);
    onChange({ ...suite, data: { name: file.name, text } });
  };

  return (
    <div className="suite-settings">
      <h3>Run order</h3>
      <div className="mode-list">
        {MODES.map((m) => (
          <label key={m.value} className={`mode-option ${o.mode === m.value ? "active" : ""}`}>
            <input type="radio" name="run-mode" checked={o.mode === m.value} onChange={() => set({ mode: m.value })} />
            <span>
              <b>{m.label}</b>
              <span className="muted small">{m.help}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="batch-options suite-options">
        <label title="Most requests in flight at once in the parallel modes">
          Concurrency
          <input type="number" min={1} max={50} value={o.concurrency} disabled={o.mode === "sequential"} onChange={(e) => set({ concurrency: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label title="Pause between cases">
          Delay (ms)
          <input type="number" min={0} step={100} value={o.delayMs} onChange={(e) => set({ delayMs: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label title="Go through the data this many times">
          Repeat
          <input type="number" min={1} max={1000} value={o.repeat} onChange={(e) => set({ repeat: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label title="Scripts running longer than this are stopped">
          Script time limit (ms)
          <input type="number" min={100} step={500} value={o.scriptTimeoutMs} onChange={(e) => set({ scriptTimeoutMs: Math.max(100, Number(e.target.value) || 5000) })} />
        </label>
      </div>
      <div className="batch-options suite-options">
        <label className="check">
          <input type="checkbox" checked={o.stopOnFailure} onChange={(e) => set({ stopOnFailure: e.target.checked })} />
          Stop on first failed case
        </label>
        <label className="check" title="Cases with their own status assertion are judged by that assertion instead">
          <input type="checkbox" checked={o.httpErrorsFail} onChange={(e) => set({ httpErrorsFail: e.target.checked })} />
          4xx/5xx fail a case that has no status assertion
        </label>
      </div>

      <h3>Data (CSV)</h3>
      <p className="muted small">With a CSV, the whole suite runs once per row and {"{{column}}"} placeholders are filled from that row. Without one, it runs once.</p>
      <div className="batch-file">
        <button className="secondary" onClick={() => inputRef.current?.click()}>
          {suite.data ? "Replace CSV…" : "Choose CSV…"}
        </button>
        {suite.data && (
          <>
            <span>
              <b>{suite.data.name}</b> · {csv?.rows.length ?? 0} rows · {csv?.headers.length ?? 0} columns
            </span>
            <button className="link-btn" onClick={() => onChange({ ...suite, data: undefined })}>
              Remove
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {fileError && <p className="warning small">{fileError}</p>}
      {csv?.warnings.map((w) => (
        <p key={w} className="warning small">
          {w}
        </p>
      ))}
      {csv && <CsvPreview csv={csv} />}

      <h3>Placeholders</h3>
      {used.length === 0 ? (
        <p className="muted small">The enabled cases do not use any {"{{placeholders}}"}.</p>
      ) : (
        <div className="placeholder-check">
          {used.map((p) => {
            const ok = known.has(p);
            const script = !ok && fromScripts(p);
            return (
              <span
                key={p}
                className={`chip ${ok ? "ok" : script ? "" : "bad"}`}
                title={ok ? (csv?.headers.includes(p) ? "From the CSV" : "From the environment") : script ? "Mentioned in a script; set with rr.vars.set" : "No CSV column or environment variable"}
              >
                {`{{${p}}}`}
              </span>
            );
          })}
        </div>
      )}

      <p className="small summary-line">
        Next run: {enabled.length} case{enabled.length === 1 ? "" : "s"} × {iterations} iteration{iterations === 1 ? "" : "s"} ={" "}
        <b>{enabled.length * iterations} requests</b>.
      </p>
    </div>
  );
}
