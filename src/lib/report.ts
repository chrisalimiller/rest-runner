import { durationOf, runStats, statusLabel, type Run } from "./run";

/* ---------- CSV ---------- */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function headerLines(headers: [string, string][]): string {
  return headers.map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** One line per call with the full request, response, and notes. CSV columns come last, prefixed "var:". */
export function toCsvReport(run: Run): string {
  const head = [
    "row",
    "result",
    "status",
    "status_text",
    "duration_ms",
    "sent_at",
    "method",
    "url",
    "request_headers",
    "request_body",
    "response_headers",
    "response_body",
    "response_size_bytes",
    "error",
    "notes",
    ...run.columns.map((c) => `var:${c}`),
  ];
  const lines = [head.map(csvCell).join(",")];
  for (const e of run.entries) {
    const o = e.outcome;
    const res = o.ok ? o.response : null;
    const cells: (string | number)[] = [
      e.index + 1,
      e.failed ? "FAIL" : "PASS",
      statusLabel(o),
      res?.statusText ?? "",
      durationOf(o),
      o.sentAt,
      o.request.method,
      o.request.url,
      headerLines(o.request.headers),
      o.request.body ?? "",
      res ? headerLines(res.headers) : "",
      res?.body ?? "",
      res?.sizeBytes ?? "",
      o.ok ? "" : o.error,
      e.notes.join("\n"),
      ...run.columns.map((c) => e.vars[c] ?? ""),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  // Leading BOM so Excel opens the file as UTF-8.
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

function statusClass(e: Run["entries"][number]): string {
  if (!e.outcome.ok) return "bad";
  const s = e.outcome.response.status;
  return s < 300 ? "ok" : s < 400 ? "redir" : "bad";
}

function headerTable(headers: [string, string][]): string {
  if (!headers.length) return `<p class="muted">None</p>`;
  return `<table class="kv">${headers.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
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

/** A single self-contained HTML file: summary, run log, and every call with its full request and response. */
export function toHtmlReport(run: Run): string {
  const st = runStats(run);
  const title = `${run.requestName} · ${formatTime(run.startedAt)}`;

  const calls = run.entries
    .map((e) => {
      const o = e.outcome;
      const res = o.ok ? o.response : null;
      const search = `${e.index + 1} ${statusLabel(o)} ${o.request.url} ${Object.values(e.vars).join(" ")}`.toLowerCase();
      return `<details class="call ${e.failed ? "failed" : "passed"}" data-search="${esc(search)}">
<summary><span class="row">#${e.index + 1}</span><span class="status ${statusClass(e)}">${esc(statusLabel(o))}</span><span class="ms">${durationOf(o)} ms</span><span class="url">${esc(o.request.method)} ${esc(o.request.url)}</span>${e.notes.length ? `<span class="note-flag" title="Has notes">●</span>` : ""}</summary>
<div class="call-body">
${e.notes.length ? `<h4>Notes</h4><ul class="notes">${e.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<h4>CSV values</h4>${headerTable(Object.entries(e.vars))}
<h4>Request</h4>
<p class="mono">${esc(o.request.method)} ${esc(o.request.url)}</p>
<p class="muted">Sent ${esc(formatTime(o.sentAt))}</p>
${headerTable(o.request.headers)}
${o.request.body ? `<pre>${esc(pretty(o.request.body))}</pre>` : ""}
<h4>Response</h4>
${
  res
    ? `<p><span class="status ${statusClass(e)}">${res.status} ${esc(res.statusText)}</span> · ${res.durationMs} ms · ${res.sizeBytes.toLocaleString()} bytes</p>
${headerTable(res.headers)}
<pre>${res.body ? esc(pretty(res.body)) : '<span class="muted">(empty body)</span>'}</pre>`
    : `<p class="status bad">No response: ${esc(o.ok ? "" : o.error)}</p>`
}
</div>
</details>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg:#fff; --soft:#f6f7f9; --border:#e1e4e8; --text:#1f2328; --muted:#6b7280; --ok:#16a34a; --bad:#dc2626; --redir:#2563eb; --accent:#ff6c37; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#1e1f22; --soft:#26272b; --border:#3a3c42; --text:#e6e6e6; --muted:#9aa0a6; --ok:#4ade80; --bad:#f87171; --redir:#60a5fa; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; } h4 { margin: 14px 0 6px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
.muted { color: var(--muted); } .mono, pre, .url, .kv td { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 16px; }
.card { background: var(--soft); border-radius: 6px; padding: 10px 12px; } .card b { display: block; font-size: 20px; } .card span { color: var(--muted); font-size: 12px; }
table { border-collapse: collapse; } .info td, .info th { text-align: left; padding: 3px 14px 3px 0; vertical-align: top; } .info th { color: var(--muted); font-weight: 500; }
.kv { width: 100%; } .kv th, .kv td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--border); vertical-align: top; word-break: break-all; } .kv th { width: 28%; font-weight: 600; }
.log { list-style: none; padding: 0; margin: 0; } .log li { padding: 2px 0; } .log time { color: var(--muted); margin-right: 8px; font-size: 12px; }
.status { font-weight: 600; } .status.ok { color: var(--ok); } .status.bad { color: var(--bad); } .status.redir { color: var(--redir); }
.toolbar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; position: sticky; top: 0; background: var(--bg); padding: 8px 0; }
.toolbar input[type=search] { flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
details.call { border: 1px solid var(--border); border-radius: 6px; margin-bottom: 6px; } details.call.failed { border-left: 3px solid var(--bad); }
summary { display: flex; gap: 12px; align-items: center; padding: 7px 10px; cursor: pointer; list-style: none; } summary::-webkit-details-marker { display: none; }
summary .row { width: 56px; color: var(--muted); } summary .status { width: 48px; } summary .ms { width: 70px; color: var(--muted); } summary .url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-flag { color: var(--accent); }
.call-body { padding: 0 12px 12px; border-top: 1px solid var(--border); }
pre { background: var(--soft); padding: 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; max-height: 480px; overflow: auto; }
.notes { margin: 0; padding-left: 18px; }
.bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--soft); margin-top: 14px; } .bar .p { background: var(--ok); } .bar .f { background: var(--bad); }
@media print { .toolbar { display: none; } details.call { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>${esc(run.requestName)}</h1>
<p class="muted">REST Runner report · ${esc(formatTime(run.startedAt))}</p>

<div class="cards">
  <div class="card"><b>${st.completed} / ${run.totalRows}</b><span>requests sent</span></div>
  <div class="card"><b class="status ok">${st.passed}</b><span>passed</span></div>
  <div class="card"><b class="status ${st.failed ? "bad" : ""}">${st.failed}</b><span>failed${st.connectionErrors ? ` (${st.connectionErrors} with no response)` : ""}</span></div>
  <div class="card"><b>${formatDuration(st.wallMs)}</b><span>total time</span></div>
  <div class="card"><b>${st.avgMs} ms</b><span>average response</span></div>
  <div class="card"><b>${st.p95Ms} ms</b><span>95th percentile</span></div>
</div>
<div class="bar"><div class="p" style="width:${run.totalRows ? (st.passed / run.totalRows) * 100 : 0}%"></div><div class="f" style="width:${run.totalRows ? (st.failed / run.totalRows) * 100 : 0}%"></div></div>

<h2>Run details</h2>
<table class="info">
<tr><th>Request</th><td class="mono">${esc(run.method)} ${esc(run.urlTemplate)}</td></tr>
<tr><th>Data file</th><td>${esc(run.csvName)} (${run.totalRows} rows; columns: ${esc(run.columns.join(", "))})</td></tr>
<tr><th>Started</th><td>${esc(formatTime(run.startedAt))}</td></tr>
<tr><th>Finished</th><td>${esc(formatTime(run.finishedAt))}</td></tr>
<tr><th>Settings</th><td>${run.options.concurrency} concurrent · ${run.options.delayMs} ms delay · 4xx/5xx ${run.options.httpErrorsFail ? "count" : "do not count"} as failures · ${run.options.stopOnFailure ? "stop on first failure" : "continue after failures"}</td></tr>
<tr><th>Status codes</th><td>${st.statusCounts.map(([s, n]) => `${esc(s)}: ${n}`).join(" · ") || "none"}</td></tr>
<tr><th>Response times</th><td>min ${st.minMs} ms · median ${st.p50Ms} ms · avg ${st.avgMs} ms · p95 ${st.p95Ms} ms · max ${st.maxMs} ms</td></tr>
</table>

<h2>Run log</h2>
<ul class="log">${run.log.map((l) => `<li><time>${esc(formatTime(l.at))}</time>${esc(l.message)}</li>`).join("")}</ul>

<h2>Calls</h2>
<div class="toolbar">
  <label><input type="radio" name="f" value="all" checked> All (${st.completed})</label>
  <label><input type="radio" name="f" value="failed"> Failed (${st.failed})</label>
  <label><input type="radio" name="f" value="passed"> Passed (${st.passed})</label>
  <input type="search" placeholder="Search row, status, URL or CSV value">
  <button type="button" id="expand">Expand all</button>
</div>
<div id="calls">
${calls}
</div>
</main>
<script>
(function () {
  var calls = Array.prototype.slice.call(document.querySelectorAll("details.call"));
  var search = document.querySelector("input[type=search]");
  function apply() {
    var f = document.querySelector("input[name=f]:checked").value;
    var q = search.value.trim().toLowerCase();
    calls.forEach(function (c) {
      var okFilter = f === "all" || c.classList.contains(f);
      var okSearch = !q || c.getAttribute("data-search").indexOf(q) !== -1;
      c.style.display = okFilter && okSearch ? "" : "none";
    });
  }
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

/** A safe file name like "Create user 2026-10-22 14-05". */
export function reportFileName(run: Run, ext: "html" | "csv"): string {
  const d = new Date(run.startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const name = run.requestName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "run";
  return `${name} ${stamp}.${ext}`;
}
