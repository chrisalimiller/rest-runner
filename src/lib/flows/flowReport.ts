import { durationOf } from "../run";
import { caseBodyHtml, toTestHtmlReport } from "../testing/testReport";
import type { Vars } from "../template";
import type { CaseResult } from "../testing/types";
import type { FlowRun, FlowRunEnd, FlowStep } from "./types";
import { NODE_TYPE_LABELS } from "./flows";

/** Steps in the order they started. */
export function orderedSteps(run: FlowRun): FlowStep[] {
  return [...run.stepList].sort((a, b) => a.index - b.index);
}

/** The HTTP status of the last response a Run step got: a number, null when no response came back, undefined when it has no result (not a Run step, or not run yet). */
export function stepStatusCode(step: FlowStep): number | null | undefined {
  const last = step.child?.results[step.child.results.length - 1];
  if (!last) return undefined;
  return last.outcome?.ok ? last.outcome.response.status : null;
}

/** The step's only call when its report holds exactly one, so the call can be shown inline; undefined for zero or several calls, or no report. */
export function singleCall(step: FlowStep): CaseResult | undefined {
  return step.child?.results.length === 1 ? step.child.results[0] : undefined;
}

/** "passed · 200" style label for the steps list: the step result with the HTTP status when it has one. */
export function stepResultLabel(step: FlowStep): string {
  const base = step.output ?? step.status;
  const code = stepStatusCode(step);
  return typeof code === "number" ? `${base} · ${code}` : base;
}

export const END_LABELS: Record<FlowRunEnd, string> = { passed: "Passed", "passed-handled": "Passed with handled failures", failed: "Failed", cancelled: "Stopped" };

/** passed → ok, passed-handled → warn (amber), failed → bad, anything else none. */
export function endTone(end: FlowRunEnd): "ok" | "warn" | "bad" | "" {
  return end === "passed" ? "ok" : end === "passed-handled" ? "warn" : end === "failed" ? "bad" : "";
}

export function stepWhere(s: FlowStep): string {
  return [s.branch ? `branch ${s.branch}` : "", s.row !== undefined ? `row ${s.row + 1}` : ""].filter(Boolean).join(", ");
}

export function varChanges(before: Vars, after: Vars): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(after)) if (before[k] !== v) out.push(`${k} = ${JSON.stringify(v)}`);
  for (const k of Object.keys(before)) if (!(k in after)) out.push(`${k} removed`);
  return out;
}

export type VarChange = "new" | "changed" | "removed" | null;

export interface VarRow {
  name: string;
  /** The value after the step. For a removed variable, the value it had before. */
  value: string;
  change: VarChange;
}

/** Every variable after a step, sorted by name, each marked new, changed or unchanged; removed ones are listed last. */
export function variableRows(before: Vars, after: Vars): VarRow[] {
  const rows: VarRow[] = Object.keys(after)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, value: after[name], change: !(name in before) ? "new" : before[name] !== after[name] ? "changed" : null }));
  const removed: VarRow[] = Object.keys(before)
    .filter((k) => !(k in after))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, value: before[name], change: "removed" }));
  return [...rows, ...removed];
}

export function flowRunWallMs(run: FlowRun): number {
  return Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

/* ---------- CSV ---------- */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One line per step, then one line per case result inside each Run step's report
 * (the step columns repeat on those lines, so the file filters well in a spreadsheet).
 */
export function toFlowCsvReport(run: FlowRun): string {
  const head = [
    "step",
    "branch",
    "loop_row",
    "step_name",
    "step_type",
    "step_result",
    "output",
    "step_ms",
    "tries",
    "step_notes",
    "variables_changed",
    "case",
    "iteration",
    "case_result",
    "failed_checks",
    "status",
    "duration_ms",
    "method",
    "url",
    "error",
    "case_notes",
    "flow_result",
  ];
  const lines = [head.map(csvCell).join(",")];
  for (const s of orderedSteps(run)) {
    const stepCells: (string | number)[] = [
      s.index + 1,
      s.branch ?? "",
      s.row !== undefined ? s.row + 1 : "",
      s.label,
      NODE_TYPE_LABELS[s.nodeType],
      s.status.toUpperCase(),
      s.output ?? "",
      s.durationMs,
      s.attempts?.length ?? "",
      s.notes.join("\n"),
      varChanges(s.varsBefore, s.varsAfter).join("\n"),
    ];
    lines.push([...stepCells, "", "", "", "", "", "", "", "", "", "", END_LABELS[run.end]].map(csvCell).join(","));
    for (const r of s.child?.results ?? []) {
      const o = r.outcome;
      lines.push(
        [
          ...stepCells,
          r.caseName,
          r.iteration + 1,
          r.passed ? "PASS" : "FAIL",
          r.checks
            .filter((c) => !c.passed)
            .map((c) => `${c.name}${c.message ? `: ${c.message}` : ""}`)
            .join("\n"),
          !o ? "Not sent" : o.ok ? o.response.status : "Error",
          o ? durationOf(o) : "",
          o?.request.method ?? "",
          o?.request.url ?? "",
          o && !o.ok ? o.error : "",
          r.notes.join("\n"),
          END_LABELS[run.end],
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/* ---------- HTML ---------- */

function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function stepHtml(s: FlowStep): string {
  const mark = s.status === "failed" ? "✕" : s.status === "cancelled" ? "■" : "✓";
  const tone = s.status === "failed" ? "bad" : s.status === "cancelled" ? "muted" : "ok";
  const where = stepWhere(s);
  const changes = varChanges(s.varsBefore, s.varsAfter);
  const child = s.child;
  const call = singleCall(s);
  const search = `${s.label} ${NODE_TYPE_LABELS[s.nodeType]} ${s.status} ${s.output ?? ""} ${s.notes.join(" ")}`.toLowerCase();
  return `<details class="step ${s.status}" data-search="${esc(search)}">
<summary><span class="n">${s.index + 1}</span><span class="mark ${tone}">${mark}</span><span class="name">${esc(s.label)}</span><span class="type">${esc(NODE_TYPE_LABELS[s.nodeType])}</span><span class="where">${esc(where)}</span><span class="out">${esc(s.child ? stepResultLabel(s) : (s.output ?? ""))}</span><span class="ms">${esc(formatDuration(s.durationMs))}</span></summary>
<div class="step-body">
${s.notes.length ? `<ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
${
  s.attempts && s.attempts.length > 1
    ? `<h4>Tries</h4><ol class="tries">${s.attempts.map((a) => `<li class="${a.passed ? "ok" : "bad"}">${a.passed ? "passed" : "failed"} · ${esc(formatDuration(a.durationMs))}${a.reason ? ` · ${esc(a.reason)}` : ""}</li>`).join("")}</ol>`
    : ""
}
${changes.length ? `<h4>Variables changed</h4><pre>${esc(changes.join("\n"))}</pre>` : ""}
${
  call
    ? `<div class="call-inline"><h4>${esc(call.caseName)}</h4>${caseBodyHtml(call)}</div>`
    : child
    ? `<h4>${esc(child.suiteName)}: ${child.passed} of ${child.completed} case${child.completed === 1 ? "" : "s"} passed</h4>
<iframe class="child" loading="lazy" title="${esc(`Report for ${s.label}`)}" srcdoc="${esc(toTestHtmlReport(child))}"></iframe>`
    : ""
}
</div>
</details>`;
}

/** One self-contained HTML file: the flow run summary, every step, and each Run step's full test report inside it. */
export function toFlowHtmlReport(run: FlowRun): string {
  const steps = orderedSteps(run);
  const title = `${run.flowName} · ${formatTime(run.startedAt)}`;
  const resultTone = endTone(run.end);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg:#fff; --soft:#f6f7f9; --border:#e1e4e8; --text:#1f2328; --muted:#6b7280; --ok:#16a34a; --bad:#dc2626; --accent:#ff6c37; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --soft:#161b22; --border:#30363d; --text:#e6edf3; --muted:#7d8590; --ok:#3fb950; --bad:#f85149; --accent:#d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; } h4 { margin: 14px 0 6px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
.muted { color: var(--muted); } pre, .mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 16px; }
.card { background: var(--soft); border-radius: 6px; padding: 10px 12px; } .card b { display: block; font-size: 20px; } .card span { color: var(--muted); font-size: 12px; }
.ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--accent); }
table { border-collapse: collapse; } .info td, .info th { text-align: left; padding: 3px 14px 3px 0; vertical-align: top; } .info th { color: var(--muted); font-weight: 500; }
.log { list-style: none; padding: 0; margin: 0; } .log li { padding: 2px 0; } .log time { color: var(--muted); margin-right: 8px; font-size: 12px; }
.toolbar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; position: sticky; top: 0; background: var(--bg); padding: 8px 0; z-index: 1; }
.toolbar input[type=search] { flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
details.step { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; } details.step.failed { border-left: 3px solid var(--bad); }
summary { display: flex; gap: 12px; align-items: center; padding: 7px 10px; cursor: pointer; list-style: none; } summary::-webkit-details-marker { display: none; }
summary .n { width: 32px; color: var(--muted); } summary .mark { width: 14px; font-weight: 700; } summary .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
summary .type, summary .where, summary .out, summary .ms { color: var(--muted); font-size: 12px; } summary .type { width: 110px; } summary .where { width: 110px; } summary .out { width: 110px; } summary .ms { width: 70px; text-align: right; }
.step-body { padding: 4px 12px 12px; border-top: 1px solid var(--border); }
.notes, .tries { margin: 6px 0; padding-left: 18px; }
pre { background: var(--soft); padding: 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
.kv { width: 100%; } .kv th, .kv td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--border); vertical-align: top; word-break: break-all; } .kv th { width: 28%; font-weight: 600; } .kv td, .mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.status { font-weight: 600; } .status.ok { color: var(--ok); } .status.bad { color: var(--bad); } .status.redir { color: #2563eb; }
.checks { list-style: none; padding: 0; margin: 0; } .checks li { padding: 2px 0; } .checks li.ok b { color: var(--ok); } .checks li.bad b { color: var(--bad); } .checks .msg { color: var(--muted); font-size: 12px; }
iframe.child { width: 100%; height: 600px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
@media print { .toolbar { display: none; } details.step { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>${esc(run.flowName)}</h1>
<p class="muted">REST Runner flow report · ${esc(formatTime(run.startedAt))}</p>
${run.flow.description ? `<p>${esc(run.flow.description)}</p>` : ""}

<div class="cards">
  <div class="card"><b class="${resultTone}">${esc(END_LABELS[run.end])}</b><span>result</span></div>
  <div class="card"><b>${run.steps}</b><span>steps ran</span></div>
  <div class="card"><b class="ok">${run.passedSteps}</b><span>run steps passed</span></div>
  <div class="card"><b class="${run.failedSteps ? "bad" : ""}">${run.failedSteps}</b><span>run steps failed</span></div>
  <div class="card"><b>${esc(formatDuration(flowRunWallMs(run)))}</b><span>total time</span></div>
</div>

<h2>Run details</h2>
<table class="info">
<tr><th>Flow</th><td>${esc(run.flowName)}</td></tr>
<tr><th>Started by</th><td>${run.trigger === "manual" ? "Run button" : esc(`Schedule: ${run.triggerLabel ?? run.trigger}`)}</td></tr>
<tr><th>Environment</th><td>${run.environmentName ? esc(run.environmentName) : '<span class="muted">None</span>'}</td></tr>
<tr><th>Started</th><td>${esc(formatTime(run.startedAt))}</td></tr>
<tr><th>Finished</th><td>${esc(formatTime(run.finishedAt))}</td></tr>
${run.endReason ? `<tr><th>Why it ended</th><td>${esc(run.endReason)}</td></tr>` : ""}
<tr><th>Variables at the end</th><td>${Object.keys(run.vars).length ? `<pre>${esc(Object.entries(run.vars).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("\n"))}</pre>` : '<span class="muted">None</span>'}</td></tr>
</table>

<h2>Run log</h2>
<ul class="log">${run.log.map((l) => `<li><time>${esc(formatTime(l.at))}</time>${esc(l.message)}</li>`).join("")}</ul>

<h2>Steps</h2>
<div class="toolbar">
  <label><input type="radio" name="f" value="all" checked> All (${steps.length})</label>
  <label><input type="radio" name="f" value="failed"> Failed (${steps.filter((s) => s.status === "failed").length})</label>
  <input type="search" placeholder="Search step, type or note">
  <button type="button" id="expand">Expand all</button>
</div>
<div id="steps">
${steps.map(stepHtml).join("\n")}
</div>
</main>
<script>
(function () {
  var steps = Array.prototype.slice.call(document.querySelectorAll("details.step"));
  var search = document.querySelector("input[type=search]");
  function apply() {
    var f = document.querySelector("input[name=f]:checked").value;
    var q = search.value.trim().toLowerCase();
    steps.forEach(function (s) {
      var ok = (f === "all" || s.classList.contains(f)) && (!q || s.getAttribute("data-search").indexOf(q) !== -1);
      s.style.display = ok ? "" : "none";
    });
  }
  document.querySelectorAll("input[name=f]").forEach(function (r) { r.addEventListener("change", apply); });
  search.addEventListener("input", apply);
  var open = false;
  document.getElementById("expand").addEventListener("click", function () {
    open = !open;
    steps.forEach(function (s) { if (s.style.display !== "none") s.open = open; });
    this.textContent = open ? "Collapse all" : "Expand all";
  });
  // Size each child report to its content once it loads.
  document.querySelectorAll("iframe.child").forEach(function (f) {
    f.addEventListener("load", function () {
      try { f.style.height = Math.min(4000, f.contentDocument.documentElement.scrollHeight + 4) + "px"; } catch (e) {}
    });
  });
})();
</script>
</body>
</html>
`;
}

/** A safe file name like "Nightly smoke 2026-10-22 14-05.html". */
export function flowReportFileName(run: FlowRun, ext: "html" | "csv"): string {
  const d = new Date(run.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const name = run.flowName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "flow run";
  return `${name} ${stamp}.${ext}`;
}
