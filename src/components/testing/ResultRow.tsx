import { statusClass } from "../../lib/format";
import { requestMs } from "../../lib/testing/testRun";
import type { CaseResult } from "../../lib/testing/types";

export function resultStatus(r: CaseResult): { label: string; cls: string } {
  if (!r.outcome) return { label: "Not sent", cls: "bad" };
  if (!r.outcome.ok) return { label: "Error", cls: "bad" };
  return { label: String(r.outcome.response.status), cls: statusClass(r.outcome.response.status) };
}

/** One line in a results table: iteration, case, status, checks passed, time. */
export function ResultRow({ result: r, selected, onSelect }: { result: CaseResult; selected: boolean; onSelect: () => void }) {
  const s = resultStatus(r);
  const passedChecks = r.checks.filter((c) => c.passed).length;
  const firstFail = r.checks.find((c) => !c.passed);
  return (
    <tr className={`${selected ? "selected" : ""} ${r.passed ? "" : "failed"}`} onClick={onSelect}>
      <td title={r.rowIndex !== null ? `CSV row ${r.rowIndex + 1}${r.repeatIndex ? `, repeat ${r.repeatIndex + 1}` : ""}` : undefined}>
        {r.iteration + 1}
        {r.notes.length > 0 && (
          <span className="note-dot" title={r.notes.join("\n")}>
            {" "}
            ●
          </span>
        )}
      </td>
      <td className="url-cell" title={firstFail ? `${firstFail.name}${firstFail.message ? `: ${firstFail.message}` : ""}` : r.caseName}>
        <span className={`pass-mark ${r.passed ? "ok" : "bad"}`}>{r.passed ? "✓" : "✕"}</span> {r.caseName}
      </td>
      <td>
        <span className={`status ${s.cls}`}>{s.label}</span>
      </td>
      <td className={passedChecks === r.checks.length ? "" : "status bad"}>
        {passedChecks}/{r.checks.length}
      </td>
      <td>{requestMs(r)} ms</td>
    </tr>
  );
}
