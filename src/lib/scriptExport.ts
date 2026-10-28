import type { BatchOptions } from "./batch";
import { certificateForExport, type CertificateEntry, type CertificateExport } from "./certificates";
import { stripJsonComments } from "./jsonFormat";
import { withAuthDefaults } from "./request";
import { applyTemplate, type Vars } from "./template";
import type { KeyValue, RequestDef } from "./types";
import pythonRunner from "./scriptExport/runner.py?raw";
import bashRunner from "./scriptExport/runner.sh?raw";

export type ScriptLanguage = "python" | "bash";

export interface ScriptExportInput {
  def: RequestDef;
  options: BatchOptions;
  /** Values for placeholders no CSV column fills: the environment, then variables left by earlier sends' scripts. */
  defaults: Vars;
  envName?: string;
  /** The CSV loaded in the app, used as the script's default file name. */
  csvName?: string;
  /** For the header comment. Defaults to now. */
  exportedAt?: Date;
  /** The app's imported certificates. The one matching the request's address gets a settings block. */
  certificates?: readonly CertificateEntry[];
}

/** The certificate the exported script would need, matched on the request's address with environment values filled in. */
function exportedCertificate(input: ScriptExportInput): CertificateExport | null {
  if (!input.certificates?.length) return null;
  return certificateForExport(applyTemplate(input.def.url, input.defaults), input.certificates, input.def.noCertificate);
}

export const SCRIPT_LANGUAGES: Record<ScriptLanguage, { label: string; extension: string; filterName: string }> = {
  python: { label: "Python", extension: "py", filterName: "Python script" },
  bash: { label: "Bash", extension: "sh", filterName: "Bash script" },
};

/** Things the exported script does differently from a run in the app, to show before saving. */
export function scriptExportNotes(input: ScriptExportInput): string[] {
  const notes: string[] = [];
  const { def } = input;
  const scripts = [(def.preScript ?? "").trim() && "pre-request", (def.postScript ?? "").trim() && "post-response"].filter(Boolean);
  if (scripts.length) {
    notes.push(`The request's ${scripts.join(" and ")} ${scripts.length > 1 ? "scripts are" : "script is"} JavaScript for the app and is not included. Values ${scripts.length > 1 ? "they set" : "it sets"} are not filled in.`);
  }
  if (Object.keys(input.defaults).length) {
    notes.push(`Values from ${input.envName ? `the ${input.envName} environment` : "the environment"} and earlier script runs are copied into the script as plain text. Check it before you share it.`);
  }
  const cert = exportedCertificate(input);
  if (cert?.client) {
    notes.push(`The app sends the certificate "${cert.client.name}" to this address. The script has settings for it, but the files are not included: fill in your own copies${cert.client.client?.hasPassphrase ? " and set REST_RUNNER_CERT_PASSPHRASE" : ""}. The script sends it to every address it calls.`);
  }
  if (cert?.ca) {
    notes.push(`The app also trusts the CA of "${cert.ca.name}" for this address; set CA_CERT to your copy of that file.`);
  }
  return notes;
}

function certificateSettingsPython(cert: CertificateExport): string[] {
  const client = cert.client?.client;
  const lines = [""];
  if (client) {
    lines.push(
      `# Client certificate "${oneLine(cert.client!.name)}". The files stay in the app: point these at your own copies.`,
      `CLIENT_CERT = ""  # ${client.format === "pkcs12" ? "a .p12/.pfx file (Python cannot read it; the script prints the openssl command to convert it)" : "a .pem file"}`,
    );
    if (client.separateKey) lines.push('CLIENT_KEY = ""  # the private key, PEM');
    if (client.hasPassphrase) lines.push("# The key's passphrase is read from the REST_RUNNER_CERT_PASSPHRASE environment variable.");
  }
  if (cert.ca) lines.push(`# Extra trusted CA from "${oneLine(cert.ca.name)}".`, 'CA_CERT = ""', `CA_ONLY = ${cert.ca.caOnly ? "True" : "False"}`);
  return lines;
}

function certificateSettingsBash(cert: CertificateExport): string[] {
  const client = cert.client?.client;
  const lines = [""];
  if (client) {
    lines.push(
      `# Client certificate "${oneLine(cert.client!.name)}". The files stay in the app: point these at your own copies.`,
      `CLIENT_CERT=''  # ${client.format === "pkcs12" ? "a .p12/.pfx file" : "a .pem file"}`,
    );
    if (client.separateKey) lines.push("CLIENT_KEY=''  # the private key, PEM");
    if (client.hasPassphrase) lines.push("# The key's passphrase is read from the REST_RUNNER_CERT_PASSPHRASE environment variable.");
  }
  if (cert.ca) lines.push(`# Extra trusted CA from "${oneLine(cert.ca.name)}". curl then trusts only this CA.`, "CA_CERT=''");
  return lines;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

function activeRows(rows: KeyValue[]): [string, string][] {
  return rows.filter((r) => r.enabled && r.key.trim() !== "").map((r) => [r.key.trim(), r.value]);
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function headerComment(input: ScriptExportInput): string {
  const { def } = input;
  const date = (input.exportedAt ?? new Date()).toISOString().slice(0, 10);
  const lines = [
    `REST Runner batch script for "${oneLine(def.name) || "Untitled request"}", exported ${date}.`,
    `Sends ${def.method} ${oneLine(def.url)} once per row of a CSV file.`,
  ];
  if (input.envName) lines.push(`Environment: ${oneLine(input.envName)} (its values are in the settings below).`);
  for (const note of scriptExportNotes(input)) lines.push(`Note: ${note}`);
  return lines.map((l) => `# ${l}`).join("\n").replace(/^# /, "");
}

export function scriptFileName(def: RequestDef, language: ScriptLanguage): string {
  const base = (def.name || "request")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "request";
  return `${base}-batch.${SCRIPT_LANGUAGES[language].extension}`;
}

/** The CSV file name for the usage example. */
function csvArg(input: { csvName?: string }): string {
  const name = input.csvName ?? "";
  return name && /^[\w.-]+$/.test(name) ? name : "data.csv";
}

/** The terminal command that runs a saved script. */
export function scriptRunCommand(language: ScriptLanguage, fileName: string, csvName?: string, windows = false): string {
  const file = /^[\w.-]+$/.test(fileName) ? fileName : `"${fileName}"`;
  const program = language === "bash" ? "bash" : windows ? "py" : "python3";
  return `${program} ${file} ${csvArg({ csvName })}`;
}

function fill(runner: string, values: Record<string, string>): string {
  // The runner files are checked out with LF endings, but be safe if git converted them.
  return runner.replace(/\r\n/g, "\n").replace(/@@([A-Z]+)@@/g, (m, name: string) => values[name] ?? m);
}

/* ---------- Python ---------- */

function py(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  // A JSON string is also a valid Python string literal.
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(py).join(", ")}]`;
  return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${py(k)}: ${py(v)}`).join(", ")}}`;
}

/** A dict written one key per line. */
function pyBlock(fields: [string, unknown][]): string {
  if (fields.length === 0) return "{}";
  return `{\n${fields.map(([k, v]) => `    ${py(k)}: ${py(v)},`).join("\n")}\n}`;
}

/** The body as it is sent: JSON comments are removed. */
function requestBody(def: RequestDef): string {
  return def.bodyMode === "json" ? stripJsonComments(def.body) : def.body;
}

function pyRequest(def: RequestDef): string {
  return pyBlock([
    ["name", def.name],
    ["method", def.method],
    ["url", def.url],
    ["params", activeRows(def.params)],
    ["headers", activeRows(def.headers)],
    ["bodyMode", def.bodyMode],
    ["body", requestBody(def)],
    ["form", activeRows(def.formBody)],
    ["auth", withAuthDefaults(def.auth)],
  ]);
}

export function buildPythonScript(input: ScriptExportInput): string {
  const { def, options } = input;
  const settings = [
    "# The request. {{name}} placeholders are filled from each CSV row.",
    `REQUEST = ${pyRequest(def)}`,
    "",
    "# Values for placeholders that no CSV column fills (a column with the same name wins).",
    `DEFAULTS = ${pyBlock(Object.entries(input.defaults))}`,
    "",
    "# The CSV file used when none is given on the command line.",
    `DEFAULT_CSV = ${py(input.csvName ?? "")}`,
    "",
    "# Run options. Command-line options override these.",
    `OPTIONS = ${pyBlock([
      ["concurrency", options.concurrency],
      ["delay_ms", options.delayMs],
      ["stop_on_failure", options.stopOnFailure],
      ["http_errors_fail", options.httpErrorsFail],
    ])}`,
    ...(exportedCertificate(input) ? certificateSettingsPython(exportedCertificate(input)!) : []),
  ].join("\n");
  return fill(pythonRunner, { HEADER: headerComment(input), FILE: scriptFileName(def, "python"), CSV: csvArg(input), SETTINGS: settings });
}

/* ---------- Bash ---------- */

/** A bash single-quoted string. */
function sq(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

type Segment = { text: string } | { name: string; raw: string; json: boolean };

/** Splits text like applyTemplate does. */
function plainSegments(input: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of input.matchAll(PLACEHOLDER)) {
    if (m.index > last) out.push({ text: input.slice(last, m.index) });
    out.push({ name: m[1], raw: m[0], json: false });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ text: input.slice(last) });
  return out;
}

/** Splits a JSON body like applyJsonTemplate does: placeholders inside JSON strings are marked for escaping. */
function jsonSegments(input: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  let inString = false;
  let i = 0;
  const flush = () => {
    if (text) out.push({ text });
    text = "";
  };
  while (i < input.length) {
    const ch = input[i];
    if (ch === "{" && input[i + 1] === "{") {
      const close = input.indexOf("}}", i + 2);
      const name = close === -1 ? "" : input.slice(i + 2, close).trim();
      if (close !== -1 && name !== "" && !/[{}]/.test(name)) {
        flush();
        out.push({ name, raw: input.slice(i, close + 2), json: inString });
        i = close + 2;
        continue;
      }
    }
    if (inString && ch === "\\") {
      text += ch + (input[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (ch === '"') inString = !inString;
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Bash lines that leave the filled-in text in $s. */
function bashTemplate(input: string, json = false, indent = "  "): string[] {
  const segments = json ? jsonSegments(input) : plainSegments(input);
  const first = segments[0];
  const startsWithText = first !== undefined && "text" in first;
  const lines = [`${indent}s=${startsWithText ? sq(first.text) : "''"}`];
  for (const seg of startsWithText ? segments.slice(1) : segments) {
    if ("text" in seg) lines.push(`${indent}s+=${sq(seg.text)}`);
    else lines.push(`${indent}${seg.json ? "vj" : "v"} ${sq(seg.name)} ${sq(seg.raw)}; s+=$REPLY`);
  }
  return lines;
}

function bashPairs(rows: [string, string][], keys: string, values: string): string[] {
  const lines: string[] = [];
  for (const [k, val] of rows) {
    lines.push(...bashTemplate(k), "  k=$s", ...bashTemplate(val), `  ${keys}+=("$k"); ${values}+=("$s")`);
  }
  return lines;
}

/** Header names are compared without placeholders filled in; they almost never have any. */
function hasHeader(rows: [string, string][], name: string): boolean {
  return rows.some(([k]) => k.toLowerCase() === name.toLowerCase());
}

function bashBuild(def: RequestDef): string {
  const headers = activeRows(def.headers);
  const lines: string[] = [
    "# Fills in the request for the current CSV row (ROW). Sets REQ_METHOD, REQ_URL,",
    "# REQ_BODY, REQ_HAS_BODY and the headers in HK (names) and HV (values).",
    "build_request() {",
    "  local s k",
    "  HK=(); HV=(); QK=(); QV=(); FK=(); FV=()",
    `  REQ_METHOD=${sq(def.method)}`,
    "  REQ_BODY=''",
    "  REQ_HAS_BODY=0",
    "  # URL",
    ...bashTemplate(def.url),
    "  REQ_URL=$s",
  ];
  const params = activeRows(def.params);
  if (params.length) lines.push("  # Query parameters", ...bashPairs(params, "QK", "QV"));
  if (headers.length) lines.push("  # Headers", ...bashPairs(headers, "HK", "HV"));

  const auth = withAuthDefaults(def.auth);
  if (auth.type === "bearer" && !hasHeader(headers, "Authorization")) {
    lines.push("  # Auth: bearer token", ...bashTemplate(auth.token), '  add_header Authorization "Bearer $s"');
  } else if (auth.type === "basic" && !hasHeader(headers, "Authorization")) {
    lines.push(
      "  # Auth: basic",
      ...bashTemplate(auth.username),
      "  k=$s",
      ...bashTemplate(auth.password),
      '  b64 "$k:$s"',
      '  add_header Authorization "Basic $REPLY"',
    );
  } else if (auth.type === "apikey") {
    lines.push(
      `  # Auth: API key in the ${auth.addTo === "header" ? "header" : "query"}`,
      ...bashTemplate(auth.key),
      '  trim "$s"; k=$REPLY',
      ...bashTemplate(auth.value),
      auth.addTo === "header"
        ? '  if [ -n "$k" ] && ! has_header "$k"; then add_header "$k" "$s"; fi'
        : '  if [ -n "$k" ]; then QK+=("$k"); QV+=("$s"); fi',
    );
  }

  if (def.method !== "GET" && def.method !== "HEAD") {
    if (def.bodyMode === "json" || def.bodyMode === "text") {
      const type = def.bodyMode === "json" ? "application/json" : "text/plain";
      lines.push("  # Body", ...bashTemplate(requestBody(def), def.bodyMode === "json"), "  REQ_BODY=$s", "  REQ_HAS_BODY=1");
      if (!hasHeader(headers, "Content-Type")) lines.push(`  add_header Content-Type ${sq(type)}`);
    } else if (def.bodyMode === "urlencoded") {
      lines.push("  # Form body", ...bashPairs(activeRows(def.formBody), "FK", "FV"), "  encode_pairs FK FV", "  REQ_BODY=$REPLY", "  REQ_HAS_BODY=1");
      if (!hasHeader(headers, "Content-Type")) lines.push("  add_header Content-Type 'application/x-www-form-urlencoded'");
    }
  }
  lines.push("  finish_url", "}");
  return lines.join("\n");
}

function bashDefaults(defaults: Vars): string {
  const entries = Object.entries(defaults);
  const lines = [
    "# Values for placeholders that no CSV column fills (a column with the same name wins).",
    "default_value() {",
    '  case "$1" in',
    ...entries.map(([k, val]) => `    ${sq(k)}) REPLY=${sq(val)} ;;`),
    "    *) return 1 ;;",
    "  esac",
    "}",
  ];
  return lines.join("\n");
}

export function buildBashScript(input: ScriptExportInput): string {
  const { def, options } = input;
  const settings = [
    "# Run options. Command-line options override these.",
    `CONCURRENCY=${Math.max(1, Math.floor(options.concurrency) || 1)}`,
    `DELAY_MS=${Math.max(0, Math.floor(options.delayMs) || 0)}`,
    `STOP_ON_FAILURE=${options.stopOnFailure ? 1 : 0}`,
    `HTTP_ERRORS_FAIL=${options.httpErrorsFail ? 1 : 0}`,
    "",
    "# The CSV file used when none is given on the command line.",
    `DEFAULT_CSV=${sq(input.csvName ?? "")}`,
    "",
    bashDefaults(input.defaults),
    "",
    bashBuild(def),
    ...(exportedCertificate(input) ? certificateSettingsBash(exportedCertificate(input)!) : []),
  ].join("\n");
  return fill(bashRunner, { HEADER: headerComment(input), FILE: scriptFileName(def, "bash"), CSV: csvArg(input), SETTINGS: settings });
}

export function buildScript(language: ScriptLanguage, input: ScriptExportInput): string {
  return language === "python" ? buildPythonScript(input) : buildBashScript(input);
}
