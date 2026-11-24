import { listSource, readCallField, resolveInputs, valueResolver } from "../../lib/tools/engine";
import { readListValue } from "../../lib/tools/lists";
import { refBreadcrumb } from "../../lib/tools/listText";
import type { SessionState } from "../../lib/tools/session";
import type { FieldFormat, ListRef, Tool, ToolCall } from "../../lib/tools/types";
import { formatFieldValue } from "../../lib/tools/view";

/** The names a value passes on its way: Customer › Devices › first where status = active › model. A removed list shows in red. */
export function RefBreadcrumb({ tool, call, list, path }: { tool: Tool; call: ToolCall | undefined; list: ListRef | undefined; path: string }) {
  const parts = refBreadcrumb(tool, call, list, path);
  return (
    <span className="ref-crumbs small" aria-label="Where this value comes from">
      {parts.map((p, i) => (
        <span key={i} className={p === "a removed list" || p === "a removed request" ? "tone-bad" : undefined}>
          {i > 0 && <span className="muted"> › </span>}
          {p}
        </span>
      ))}
    </span>
  );
}

/** What a value reads in the sample response now, or why it cannot be read ("Customer has no devices"). */
export function sampleOfRef(tool: Tool, call: ToolCall | undefined, state: Pick<SessionState, "inputs" | "results">, path: string, list: ListRef | undefined, format: FieldFormat = "text"): { ok: boolean; text: string } | null {
  const result = call ? state.results[call.id] : undefined;
  if (!call || !result || result.state !== "done") return null;
  const resolve = valueResolver(tool, resolveInputs(tool, state.inputs), state.results);
  if (!list) return { ok: true, text: formatFieldValue(readCallField(call, result, path, undefined, resolve), format) };
  const r = readListValue(listSource(call, result, resolve), path, list);
  return r.ok ? { ok: true, text: formatFieldValue(r.value, format) } : { ok: false, text: r.message };
}

/** The live sample line under a value that reads a list. */
export function RefSample({ tool, call, state, path, list, format }: { tool: Tool; call: ToolCall | undefined; state: Pick<SessionState, "inputs" | "results">; path: string; list: ListRef | undefined; format?: FieldFormat }) {
  const s = sampleOfRef(tool, call, state, path, list, format);
  if (!s) return <span className="small muted">Run with sample to see the value.</span>;
  return (
    <span className={`small ref-sample ${s.ok ? "" : "tone-warn"}`} role="status">
      {s.ok ? (
        <>
          <span className="muted">Sample: </span>
          {s.text}
        </>
      ) : (
        s.text
      )}
    </span>
  );
}
