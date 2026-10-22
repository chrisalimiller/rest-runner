import { durationOf } from "../run";
import { describeMode } from "./describe";
import { caseStats, requestMs, testRunTimes, type TestRun } from "./testRun";
import type { CaseResult, ScriptOutput } from "./types";

/* ---------- shared ---------- */

function statusText(r: CaseResult): string {
  if (!r.outcome) return "Not sent";
  return r.outcome.ok ? String(r.outcome.response.status) : "Error";
}

function headerLines(headers: [string, string][]): string {
  return headers.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function scriptLog(r: CaseResult): string {
  const part = (label: string, s?: ScriptOutput) =>
    s ? [...s.logs.map((l) => `[${label}] ${l}`), ...(s.error ? [`[${label}] ERROR ${s.error}`] : [])] : [];
  return [...part("pre", r.preScript), ...part("post", r.postScript)].join("\n");
}

function iterationLabel(r: CaseResult): string {
  return r.rowIndex === null ? `${r.iteration + 1}` : `${r.iteration + 1} (row ${r.rowIndex + 1}${r.repeatIndex ? `, repeat ${r.repeatIndex + 1}` : ""})`;
}

/* ---------- CSV ---------- */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One line per case per iteration, with every check, the full request and response, script output and notes. */
export function toTestCsvReport(run: TestRun): string {
  const head = [
    "iteration",
    "csv_row",
    "repeat",
    "case_number",
    "case",
    "result",
    "checks_passed",
    "checks_total",
    "failed_checks",
    "all_checks",
    "status",
    "duration_ms",
    "started_at",
    "method",
    "url",
    "request_headers",
    "request_body",
    "response_headers",
    "response_body",
    "error",
    "script_output",
    "notes",
    ...run.columns.map((c) => `var:${c}`),
  ];
  const lines = [head.map(csvCell).join(",")];
  for (const r of run.results) {
    const o = r.outcome;
    const res = o?.ok ? o.response : null;
    const failed = r.checks.filter((c) => !c.passed);
    const data = (c: string) => r.vars[c] ?? "";
    const cells: (string | number)[] = [
      r.iteration + 1,
      r.rowIndex === null ? "" : r.rowIndex + 1,
      r.repeatIndex + 1,
      r.caseIndex + 1,
      r.caseName,
      r.passed ? "PASS" : "FAIL",
      r.checks.length - failed.length,
      r.checks.length,
      failed.map((c) => `${c.name}${c.message ? `: ${c.message}` : ""}`).join("\n"),
      r.checks.map((c) => `${c.passed ? "PASS" : "FAIL"} ${c.name}`).join("\n"),
      statusText(r),
      o ? durationOf(o) : "",
      r.startedAt,
      o?.request.method ?? "",
      o?.request.url ?? "",
      o ? headerLines(o.request.headers) : "",
      o?.request.body ?? "",
      res ? headerLines(res.headers) : "",
      res?.body ?? "",
      o && !o.ok ? o.error : "",
      scriptLog(r),
      r.notes.join("\n"),
      ...run.columns.map(data),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/* ---------- HTML ---------- */

function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function pretty(body: string): string {
  const t = body.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      // not JSON
    }
  }
  return body;
}

function statusClass(r: CaseResult): string {
  if (!r.outcome || !r.outcome.ok) return "bad";
  const s = r.outcome.response.status;
  return s < 300 ? "ok" : s < 400 ? "redir" : "bad";
}

function kvTable(rows: [string, string][]): string {
  if (!rows.length) return `<p class="muted">None</p>`;
  return `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

function scriptHtml(title: string, s?: ScriptOutput): string {
  if (!s) return "";
  return `<h4>${esc(title)} <span class="muted">(${s.durationMs} ms)</span></h4>${s.error ? `<p class="status bad">Error: ${esc(s.error)}</p>` : ""}${
    s.logs.length ? `<pre>${esc(s.logs.join("\n"))}</pre>` : `<p class="muted">No console output.</p>`
  }`;
}

/** A single self-contained HTML file: summary, per-case table, run log, and every case result with its checks, request and response. */
export function toTestHtmlReport(run: TestRun): string {
  const t = testRunTimes(run);
  const perCase = caseStats(run);
  const title = `${run.suiteName} · ${formatTime(run.startedAt)}`;
  const total = run.checksPassed + run.checksFailed;

  const results = run.results
    .map((r) => {
      const o = r.outcome;
      const res = o?.ok ? o.response : null;
      const passedChecks = r.checks.filter((c) => c.passed).length;
      const search = `${r.caseName} ${statusText(r)} ${o?.request.url ?? ""} ${Object.values(r.vars).join(" ")} ${r.checks.map((c) => c.name).join(" ")}`.toLowerCase();
      return `<details class="call ${r.passed ? "passed" : "failed"}" data-search="${esc(search)}" data-case="${esc(r.caseId)}">
<summary><span class="row">#${r.iteration + 1}</span><span class="mark ${r.passed ? "ok" : "bad"}">${r.passed ? "✓" : "✕"}</span><span class="case">${esc(r.caseName)}</span><span class="status ${statusClass(r)}">${esc(statusText(r))}</span><span class="checks ${passedChecks === r.checks.length ? "" : "bad"}">${passedChecks}/${r.checks.length} checks</span><span class="ms">${requestMs(r)} ms</span>${r.notes.length ? `<span class="note-flag" title="Has notes">●</span>` : ""}</summary>
<div class="call-body">
<h4>Checks</h4>
${
  r.checks.length
    ? `<ul class="checks">${r.checks.map((c) => `<li class="${c.passed ? "ok" : "bad"}"><b>${c.passed ? "✓" : "✕"}</b> ${esc(c.name)} <span class="muted">${esc(c.source)}</span>${c.message ? ` <span class="msg">${esc(c.message)}</span>` : ""}</li>`).join("")}</ul>`
    : `<p class="muted">No checks ran.</p>`
}
${r.notes.length ? `<h4>Notes</h4><ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<p class="muted">Iteration ${esc(iterationLabel(r))} · started ${esc(formatTime(r.startedAt))} · case took ${r.durationMs} ms with scripts</p>
<h4>Variables</h4>${kvTable(Object.entries(r.vars))}
${
  o
    ? `<h4>Request</h4>
<p class="mono">${esc(o.request.method)} ${esc(o.request.url)}</p>
${kvTable(o.request.headers)}
${o.request.body ? `<pre>${esc(pretty(o.request.body))}</pre>` : ""}
<h4>Response</h4>
${
  res
    ? `<p><span class="status ${statusClass(r)}">${res.status} ${esc(res.statusText)}</span> · ${res.durationMs} ms · ${res.sizeBytes.toLocaleString()} bytes</p>
${kvTable(res.headers)}
<pre>${res.body ? esc(pretty(res.body)) : '<span class="muted">(empty body)</span>'}</pre>`
    : `<p class="status bad">No response: ${esc(o.ok ? "" : o.error)}</p>`
}`
    : `<p class="status bad">The request was not sent.</p>`
}
${scriptHtml("Pre-request script", r.preScript)}
${scriptHtml("Post-response script", r.postScript)}
</div>
</details>`;
    })
    .join("\n");

  const caseRows = perCase
    .map(
      (c) =>
        `<tr data-case="${esc(c.caseId)}"><td>${c.caseIndex + 1}</td><td>${esc(c.caseName)}</td><td class="status ok">${c.passed}</td><td class="status ${c.failed ? "bad" : ""}">${c.failed}</td><td>${c.avgMs} ms</td><td>${c.maxMs} ms</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg:#fff; --soft:#f6f7f9; --border:#e1e4e8; --text:#1f2328; --muted:#6b7280; --ok:#16a34a; --bad:#dc2626; --redir:#2563eb; --accent:#ff6c37; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --soft:#161b22; --border:#30363d; --text:#e6edf3; --muted:#7d8590; --ok:#3fb950; --bad:#f85149; --redir:#58a6ff; --accent:#d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; } h4 { margin: 14px 0 6px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
.muted { color: var(--muted); } .mono, pre, .kv td { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 16px; }
.card { background: var(--soft); border-radius: 6px; padding: 10px 12px; } .card b { display: block; font-size: 20px; } .card span { color: var(--muted); font-size: 12px; }
table { border-collapse: collapse; } .info td, .info th { text-align: left; padding: 3px 14px 3px 0; vertical-align: top; } .info th { color: var(--muted); font-weight: 500; }
.cases { width: 100%; } .cases th, .cases td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--border); } .cases th { color: var(--muted); font-weight: 500; } .cases tbody tr { cursor: pointer; } .cases tbody tr:hover, .cases tr.active { background: var(--soft); }
.kv { width: 100%; } .kv th, .kv td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--border); vertical-align: top; word-break: break-all; } .kv th { width: 28%; font-weight: 600; }
.log { list-style: none; padding: 0; margin: 0; } .log li { padding: 2px 0; } .log time { color: var(--muted); margin-right: 8px; font-size: 12px; }
.status { font-weight: 600; } .status.ok, .ok { color: var(--ok); } .status.bad, .bad { color: var(--bad); } .status.redir { color: var(--redir); }
.toolbar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; position: sticky; top: 0; background: var(--bg); padding: 8px 0; }
.toolbar input[type=search] { flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
details.call { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; } details.call.failed { border-left: 3px solid var(--bad); }
summary { display: flex; gap: 12px; align-items: center; padding: 7px 10px; cursor: pointer; list-style: none; } summary::-webkit-details-marker { display: none; }
summary .row { width: 44px; color: var(--muted); } summary .mark { width: 14px; font-weight: 700; } summary .case { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } summary .status { width: 60px; } summary .checks { width: 90px; color: var(--muted); } summary .checks.bad { color: var(--bad); } summary .ms { width: 70px; color: var(--muted); }
.note-flag { color: var(--accent); }
.call-body { padding: 0 12px 12px; border-top: 1px solid var(--border); }
.checks { list-style: none; padding: 0; margin: 0; } .checks li { padding: 2px 0; } .checks li.ok b { color: var(--ok); } .checks li.bad b { color: var(--bad); } .checks li { color: var(--text); } .checks .msg { color: var(--muted); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
pre { background: var(--soft); padding: 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; max-height: 480px; overflow: auto; }
.notes { margin: 0; padding-left: 18px; }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--soft); margin-top: 14px; } .bar .p { background: var(--ok); } .bar .f { background: var(--bad); }
@media print { .toolbar { display: none; } details.call { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>${esc(run.suiteName)}</h1>
<p class="muted">REST Runner test report · ${esc(formatTime(run.startedAt))}</p>
${run.suite.description ? `<p>${esc(run.suite.description)}</p>` : ""}

<div class="cards">
  <div class="card"><b>${run.completed} / ${run.plannedCases}</b><span>cases ran</span></div>
  <div class="card"><b class="status ok">${run.passed}</b><span>cases passed</span></div>
  <div class="card"><b class="status ${run.failed ? "bad" : ""}">${run.failed}</b><span>cases failed</span></div>
  <div class="card"><b>${run.checksPassed} / ${total}</b><span>checks passed</span></div>
  <div class="card"><b>${formatDuration(t.wallMs)}</b><span>total time</span></div>
  <div class="card"><b>${t.avgMs} ms</b><span>average response</span></div>
  <div class="card"><b>${t.p95Ms} ms</b><span>95th percentile</span></div>
</div>
<div class="bar"><div class="p" style="width:${run.plannedCases ? (run.passed / run.plannedCases) * 100 : 0}%"></div><div class="f" style="width:${run.plannedCases ? (run.failed / run.plannedCases) * 100 : 0}%"></div></div>

<h2>Run details</h2>
<table class="info">
<tr><th>Suite</th><td>${esc(run.suiteName)} (${run.suite.cases.filter((c) => c.enabled).length} enabled cases)</td></tr>
<tr><th>Iterations</th><td>${run.iterations}</td></tr>
<tr><th>Data file</th><td>${run.csvName ? `${esc(run.csvName)} (columns: ${esc(run.columns.join(", "))})` : '<span class="muted">None</span>'}</td></tr>
<tr><th>Environment</th><td>${run.environmentName ? esc(run.environmentName) : '<span class="muted">None</span>'}</td></tr>
<tr><th>Run order</th><td>${esc(describeMode(run.options))}</td></tr>
<tr><th>Started</th><td>${esc(formatTime(run.startedAt))}</td></tr>
<tr><th>Finished</th><td>${esc(formatTime(run.finishedAt))}</td></tr>
</table>

<h2>By test case</h2>
<p class="muted">Click a case to show only its results below.</p>
<table class="cases">
<thead><tr><th>#</th><th>Case</th><th>Passed</th><th>Failed</th><th>Avg</th><th>Max</th></tr></thead>
<tbody>${caseRows}</tbody>
</table>

<h2>Run log</h2>
<ul class="log">${run.log.map((l) => `<li><time>${esc(formatTime(l.at))}</time>${esc(l.message)}</li>`).join("")}</ul>

<h2>Results</h2>
<div class="toolbar">
  <label><input type="radio" name="f" value="all" checked> All (${run.completed})</label>
  <label><input type="radio" name="f" value="failed"> Failed (${run.failed})</label>
  <label><input type="radio" name="f" value="passed"> Passed (${run.passed})</label>
  <input type="search" placeholder="Search case, status, URL, value or check">
  <button type="button" id="expand">Expand all</button>
</div>
<div id="calls">
${results}
</div>
</main>
<script>
(function () {
  var calls = Array.prototype.slice.call(document.querySelectorAll("details.call"));
  var rows = Array.prototype.slice.call(document.querySelectorAll(".cases tbody tr"));
  var search = document.querySelector("input[type=search]");
  var onlyCase = null;
  function apply() {
    var f = document.querySelector("input[name=f]:checked").value;
    var q = search.value.trim().toLowerCase();
    calls.forEach(function (c) {
      var okFilter = f === "all" || c.classList.contains(f);
      var okSearch = !q || c.getAttribute("data-search").indexOf(q) !== -1;
      var okCase = !onlyCase || c.getAttribute("data-case") === onlyCase;
      c.style.display = okFilter && okSearch && okCase ? "" : "none";
    });
  }
  rows.forEach(function (r) {
    r.addEventListener("click", function () {
      var id = r.getAttribute("data-case");
      onlyCase = onlyCase === id ? null : id;
      rows.forEach(function (x) { x.classList.toggle("active", x.getAttribute("data-case") === onlyCase); });
      apply();
    });
  });
  document.querySelectorAll("input[name=f]").forEach(function (r) { r.addEventListener("change", apply); });
  search.addEventListener("input", apply);
  var open = false;
  document.getElementById("expand").addEventListener("click", function () {
    open = !open;
    calls.forEach(function (c) { if (c.style.display !== "none") c.open = open; });
    this.textContent = open ? "Collapse all" : "Expand all";
  });
})();
</script>
</body>
</html>
`;
}

/** A safe file name like "Smoke tests 2026-10-22 14-05.html". */
export function testReportFileName(run: TestRun, ext: "html" | "csv"): string {
  const d = new Date(run.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const name = run.suiteName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "test run";
  return `${name} ${stamp}.${ext}`;
}
