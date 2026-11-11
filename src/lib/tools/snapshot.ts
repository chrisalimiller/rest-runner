import type { RequestLookup } from "../flows/flows";
import { redactReport } from "../secrets";
import { callView, fieldRows, inputsSummary, jsonText, numberView, rawResponseText, requestLine, statusBadgeView, statusLabel, tableView } from "./view";
import type { CallResult, Tool, ToolBlock } from "./types";

/** "Save as HTML": one self-contained page with the blocks as they look, to send to someone. Pure; every value is escaped. */

function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export interface SnapshotInput {
  tool: Tool;
  results: Record<string, CallResult>;
  inputs: Record<string, string>;
  findRequest: RequestLookup;
  environmentName?: string;
  /** When the lookup was made (ISO). */
  at?: string;
  /** Secret values to mask, as for history and the other reports. */
  secrets?: readonly string[];
}

function blockHtml(block: ToolBlock, input: SnapshotInput): string {
  const { tool, results, findRequest } = input;
  const call = block.callId ? tool.calls.find((c) => c.id === block.callId) : undefined;
  const result = call ? results[call.id] : undefined;
  const title = block.title || call?.name || "";
  const head = title ? `<h3>${esc(title)}</h3>` : "";
  if (block.type === "note") return `<section class="block">${head}${block.text ? `<p>${esc(block.text)}</p>` : ""}</section>`;
  if (block.type === "input") {
    const name = block.inputName ?? "";
    return `<section class="block">${head}<p class="mono">${esc(name)}: ${esc(input.inputs[name] ?? "")}</p></section>`;
  }
  if (block.type === "action" || !call) return "";
  const view = callView({ result, sending: false, lookingUp: false });
  const line = requestLine(findRequest(call.requestId));
  const status = statusLabel(view);
  const tone = view.kind === "ok" ? "ok" : view.kind === "http-error" || view.kind === "network-error" ? "bad" : "muted";
  const header = `<header>${head}${line ? `<span class="req mono">${esc(line.method)} ${esc(line.path)}</span>` : ""}${status ? `<span class="status ${tone}">${esc(status)}</span>` : ""}</header>`;
  let body: string;
  if (!result) body = `<p class="muted">Not looked up.</p>`;
  else if (view.kind === "skipped") body = `<p class="warn">${esc(view.message)}</p>`;
  else if (view.kind === "network-error") body = `<p class="bad">${esc(view.message)}</p>`;
  else if (view.kind === "stopped") body = `<p class="muted">Stopped.</p>`;
  else if (view.kind === "http-error") body = `<pre>${esc(rawResponseText(result) || "(empty)")}</pre>`;
  else {
    switch (block.type) {
      case "fields":
        body = `<dl>${fieldRows(block, call, result).map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join("")}</dl>`;
        break;
      case "number": {
        const n = numberView(block, call, result);
        body = `<p class="number">${esc(n.value)}${n.unit ? ` <span class="muted">${esc(n.unit)}</span>` : ""}</p>`;
        break;
      }
      case "status": {
        const s = statusBadgeView(block, call, result);
        body = `<p><span class="badge ${s.colour}">${esc(s.text)}</span></p>`;
        break;
      }
      case "json":
        body = `<pre>${esc(jsonText(block, call, result) || "(nothing at that path)")}</pre>`;
        break;
      case "table": {
        const t = tableView(block, call, result);
        body = t.rows.length
          ? `<table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r, i) => `<tr${t.pickedIndex === i ? ' class="picked"' : ""}>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
          : `<p class="muted">No rows.</p>`;
        break;
      }
      default:
        body = "";
    }
  }
  return `<section class="block">${header}${body}</section>`;
}

/** The blocks of a row side by side, rows in order. */
function boardHtml(input: SnapshotInput): string {
  const rows = new Map<number, ToolBlock[]>();
  for (const b of input.tool.blocks) rows.set(b.row, [...(rows.get(b.row) ?? []), b]);
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => `<div class="row" style="grid-template-columns:repeat(${list.length},minmax(0,1fr))">${list.map((b) => blockHtml(b, input)).join("")}</div>`)
    .join("\n");
}

const STYLE = `:root { --bg:#fff; --soft:#f6f7f9; --border:#e1e4e8; --text:#1f2328; --muted:#6b7280; --ok:#16a34a; --bad:#dc2626; --accent:#ff6c37; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --soft:#161b22; --border:#30363d; --text:#e6edf3; --muted:#7d8590; --ok:#3fb950; --bad:#f85149; --accent:#d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h3 { font-size: 14px; margin: 0; }
.muted { color: var(--muted); } .ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--accent); }
.mono, pre, td, .req { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.row { display: grid; gap: 12px; margin-top: 12px; }
.block { border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; min-width: 0; }
.block header { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; }
.req { color: var(--muted); flex: 1; } .status { font-weight: 600; } .status.muted { color: var(--muted); }
dl { margin: 0; } dl div { display: flex; gap: 12px; padding: 3px 0; border-bottom: 1px solid var(--border); } dt { width: 40%; color: var(--muted); } dd { margin: 0; word-break: break-word; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--border); } th { color: var(--muted); font-weight: 600; } tr.picked td { background: var(--soft); font-weight: 600; }
pre { background: var(--soft); padding: 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; max-height: 480px; overflow: auto; margin: 0; }
.number { font-size: 24px; font-weight: 700; margin: 0; }
.badge { padding: 2px 8px; border-radius: 10px; font-weight: 600; background: var(--soft); } .badge.green { color: var(--ok); } .badge.red { color: var(--bad); } .badge.amber { color: var(--accent); } .badge.blue { color: #2563eb; }
@media print { .block { break-inside: avoid; } }`;

/** The page. Secrets are masked in everything shown (values, errors and response text) with the rules history and reports use. */
export function toToolSnapshot(input: SnapshotInput): string {
  const safe = redactReport(input, input.secrets ?? []) as SnapshotInput;
  // redactReport copies plain data; the lookup function is kept as given.
  const data: SnapshotInput = { ...safe, findRequest: input.findRequest };
  const summary = inputsSummary(data.inputs);
  const title = `${data.tool.name || "Tool"}${summary ? ` · ${summary}` : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${STYLE}
</style>
</head>
<body>
<main>
<h1>${esc(data.tool.name || "(unnamed)")}</h1>
<p class="muted">REST Runner lookup${data.at ? ` · ${esc(formatTime(data.at))}` : ""}${data.environmentName ? ` · ${esc(data.environmentName)}` : ""}${summary ? ` · ${esc(summary)}` : ""}</p>
${data.tool.description ? `<p>${esc(data.tool.description)}</p>` : ""}
${boardHtml(data)}
</main>
</body>
</html>
`;
}

/** A safe file name like "Subscriber 360 100234.html". */
export function snapshotFileName(tool: Pick<Tool, "name">, inputs: Record<string, string>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const first = Object.values(inputs).find((v) => v !== "") ?? "";
  return `${[clean(tool.name) || "tool", clean(first).slice(0, 40)].filter(Boolean).join(" ")}.html`;
}
