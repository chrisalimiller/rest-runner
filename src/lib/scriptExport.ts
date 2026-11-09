import type { BatchOptions } from "./batch";
import { certificateForExport, type CertificateEntry, type CertificateExport } from "./certificates";
import { stripJsonComments } from "./jsonFormat";
import { loadEnvironments } from "./environments";
import { storedSecrets } from "./secrets";
import { withAuthDefaults } from "./request";
import { applyTemplate, type Vars } from "./template";
import { isHttpMethod, type KeyValue, type RequestDef } from "./types";
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
  /** Names (keys of `defaults`) of secret variables. Default: the secret variables of the saved environments. */
  secretNames?: readonly string[];
  /** Known secret values; a default holding one of them is treated as secret. Default: every secret on this computer. */
  secretValues?: readonly string[];
}

/** The `defaults` keys whose values are secret: they are never written into a script. */
function secretDefaults(input: ScriptExportInput): Set<string> {
  const names = new Set<string>(input.secretNames ?? []);
  if (!input.secretNames) {
    try {
      for (const env of loadEnvironments()) {
        if (input.envName && env.name !== input.envName) continue;
        for (const v of env.vars) if (v.secret && v.key.trim() !== "") names.add(v.key.trim());
      }
    } catch {
      /* storage unavailable */
    }
  }
  let values: readonly string[] = input.secretValues ?? [];
  if (!input.secretValues) {
    try {
      values = storedSecrets();
    } catch {
      values = [];
    }
  }
  const known = new Set(values.filter((v) => v !== ""));
  const out = new Set<string>();
  for (const [k, v] of Object.entries(input.defaults)) if (names.has(k) || (v !== "" && known.has(v))) out.add(k);
  return out;
}

/** Environment variable for a secret default, e.g. `token` becomes RR_SECRET_TOKEN. Distinct names stay distinct. */
function secretEnvNames(keys: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const k of keys) {
    const base = `RR_SECRET_${k.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "VAR"}`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    out.set(k, name);
  }
  return out;
}

/** Defaults split into plain values (written into the script) and secret ones (read from RR_SECRET_* variables). */
function splitDefaults(input: ScriptExportInput): { plain: [string, string][]; secret: Map<string, string> } {
  const secrets = secretDefaults(input);
  return {
    plain: Object.entries(input.defaults).filter(([k]) => !secrets.has(k)),
    secret: secretEnvNames([...secrets]),
  };
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
    notes.push(`The request's ${scripts.join(" and ")} ${scripts.length > 1 ? "scripts are JavaScript for the app and are" : "script is JavaScript for the app and is"} not included. Values ${scripts.length > 1 ? "they set" : "it sets"} are not filled in.`);
  }
  const { plain, secret } = splitDefaults(input);
  if (plain.length) {
    notes.push(`Values from ${input.envName ? `the ${input.envName} environment` : "the environment"} and earlier script runs are copied into the script as plain text. Check it before you share it.`);
  }
  if (secret.size) {
    notes.push(`Secret values are not written into the script. Set ${[...secret.values()].join(", ")} in your terminal before you run it.`);
  }
  const cert = exportedCertificate(input);
  if (cert?.client) {
    notes.push(`The app sends the certificate "${cert.client.name}" to this address. The script has settings for it, but the files are not included: fill in your own copies${cert.client.client?.hasPassphrase ? " and set REST_RUNNER_CERT_PASSPHRASE" : ""}. The script sends it to every address it calls.`);
  }
  if (cert?.ca) {
    notes.push(`The app also trusts the CA of "${cert.ca.name}" for this address; set CA_CERT to your copy of that file.`);
  }
  if (input.options.concurrency > 1) {
    notes.push(`The script sends one request at a time, not ${Math.floor(input.options.concurrency)} at once like the app.`);
  }
  return notes;
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
  // The runner text already says requests go one at a time.
  for (const note of scriptExportNotes(input)) if (!note.startsWith("The script sends one request")) lines.push(`Note: ${note}`);
  return lines.flatMap((line) => line.split(/\r\n|\r|\n/)).map((line) => `# ${line}`).join("\n").replace(/^# /, "");
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


/** Fills the @@NAME@@ markers and keeps the "#@if name" ... "#@end" blocks whose flag is on ("!name" for off). */
function fill(runner: string, values: Record<string, string>, flags: Record<string, boolean>): string {
  // The runner files are checked out with LF endings, but be safe if git converted them.
  const kept = runner
    .replace(/\r\n/g, "\n")
    .replace(/^#@if (!?)(\w+)\n([\s\S]*?)^#@end\n/gm, (_m, not: string, name: string, body: string) => (Boolean(flags[name]) !== Boolean(not) ? body : ""));
  return kept.replace(/@@([A-Z]+)@@/g, (m, name: string) => values[name] ?? m);
}

/** The body as it is sent: JSON comments are removed. */
function requestBody(def: RequestDef): string {
  return def.bodyMode === "json" ? stripJsonComments(def.body) : def.body;
}

function sendsBody(def: RequestDef): boolean {
  return def.method !== "GET" && def.method !== "HEAD" && def.bodyMode !== "none";
}

/** Header names are compared without placeholders filled in; they almost never have any. */
function hasHeader(rows: [string, string][], name: string): boolean {
  return rows.some(([k]) => k.toLowerCase() === name.toLowerCase());
}

/** What parts of the runner a request needs. */
function runnerFlags(input: ScriptExportInput): Record<string, boolean> {
  const { def } = input;
  const auth = withAuthDefaults(def.auth);
  const body = sendsBody(def) ? def.bodyMode : "none";
  return {
    json: body === "json" && jsonSegments(requestBody(def)).some((seg) => "name" in seg && seg.json),
    encode: activeRows(def.params).length > 0 || body === "urlencoded" || (auth.type === "apikey" && auth.addTo !== "header"),
    apikeyheader: auth.type === "apikey" && auth.addTo === "header",
    cert: exportedCertificate(input) !== null,
  };
}

/* ---------- Python ---------- */

function py(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // A JSON string is also a valid Python string literal. Single quotes read better around JSON bodies.
    const text = JSON.stringify(value);
    return value.includes('"') && !value.includes("'") ? `'${text.slice(1, -1).replace(/\\(.)/g, (m, c: string) => (c === '"' ? c : m))}'` : text;
  }
  if (Array.isArray(value)) return `[${value.map(py).join(", ")}]`;
  return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${py(k)}: ${py(v)}`).join(", ")}}`;
}

/** The VALUES dict: plain defaults as literals, secret ones read from RR_SECRET_* environment variables. */
function pyValues(input: ScriptExportInput): string {
  const { plain, secret } = splitDefaults(input);
  const lines = [...plain.map(([k, v]) => `    ${py(k)}: ${py(v)},`), ...[...secret].map(([k, env]) => `    ${py(k)}: os.environ.get(${py(env)}, ""),`)];
  return lines.length ? `{\n${lines.join("\n")}\n}` : "{}";
}

/** A Python expression for text with placeholders filled in from v. */
function pyFill(text: string, json = false): string {
  if (!(json ? jsonSegments(text).some((seg) => "name" in seg) : hasPlaceholder(text))) return py(text);
  return `${json ? "fill_json" : "fill"}(${py(text)}, v)`;
}

function pyPairs(rows: [string, string][], indent = "    "): string {
  if (rows.length === 0) return "[]";
  return `[\n${rows.map(([k, val]) => `${indent}    (${pyFill(k)}, ${pyFill(val)}),`).join("\n")}\n${indent}]`;
}

function pyRequest(def: RequestDef): string {
  const headers = activeRows(def.headers);
  const lines = [
    "def build_request(v):",
    '    """Fills in the request for one CSV row. v holds the values for the placeholders."""',
    `    url = ${pyFill(def.url)}`,
    `    query = ${pyPairs(activeRows(def.params))}`,
    `    headers = ${pyPairs(headers)}`,
  ];
  const auth = withAuthDefaults(def.auth);
  if (auth.type === "bearer" && !hasHeader(headers, "Authorization")) {
    lines.push(`    headers.append(("Authorization", "Bearer " + ${pyFill(auth.token)}))`);
  } else if (auth.type === "basic" && !hasHeader(headers, "Authorization")) {
    lines.push(
      `    login = ${pyFill(auth.username)} + ":" + ${pyFill(auth.password)}`,
      '    headers.append(("Authorization", "Basic " + base64.b64encode(login.encode("utf-8")).decode("ascii")))',
    );
  } else if (auth.type === "apikey") {
    lines.push(`    key = ${pyFill(auth.key)}.strip()`);
    lines.push(
      auth.addTo === "header"
        ? `    if key and not any(k.lower() == key.lower() for k, _ in headers):\n        headers.append((key, ${pyFill(auth.value)}))`
        : `    if key:\n        query.append((key, ${pyFill(auth.value)}))`,
    );
  }
  let body = "None";
  if (sendsBody(def)) {
    const type = { json: "application/json", text: "text/plain", urlencoded: "application/x-www-form-urlencoded" }[def.bodyMode as "json" | "text" | "urlencoded"];
    if (!hasHeader(headers, "Content-Type")) lines.push(`    headers.append(("Content-Type", ${py(type)}))`);
    if (def.bodyMode === "urlencoded") {
      lines.push(`    body = encode(${pyPairs(activeRows(def.formBody))})`);
    } else {
      lines.push(`    body = ${pyFill(requestBody(def), def.bodyMode === "json")}`);
    }
    body = "body";
  }
  lines.push(`    return ${py(def.method)}, full_url(url, query), headers, ${body}`);
  return lines.join("\n");
}

function pyCertificateSettings(cert: CertificateExport): string[] {
  const client = cert.client?.client;
  const lines = ["", "# Certificates. The files stay in the app: point these at your own copies."];
  if (client) {
    lines.push(`# Client certificate "${oneLine(cert.client!.name)}".${client.hasPassphrase ? " Its passphrase is read from the REST_RUNNER_CERT_PASSPHRASE environment variable." : ""}`);
  }
  lines.push(
    `CLIENT_CERT = ""  # ${client ? (client.format === "pkcs12" ? "a .p12/.pfx file (Python cannot read it; the script prints the openssl command to convert it)" : "a .pem file") : "none"}`,
    `CLIENT_KEY = ""  # ${client?.separateKey ? "the private key, PEM" : "not needed"}`,
    `CA_CERT = ""  # ${cert.ca ? `extra trusted CA from "${oneLine(cert.ca.name)}"` : "none"}`,
    `CA_ONLY = ${cert.ca?.caOnly ? "True" : "False"}  # True trusts only CA_CERT`,
  );
  return lines;
}

export function buildPythonScript(input: ScriptExportInput): string {
  if (!isHttpMethod(input.def.method)) throw new Error("Unsupported HTTP method.");
  const { def, options } = input;
  const cert = exportedCertificate(input);
  const settings = [
    `CSV_FILE = ${py(input.csvName ?? "")}  # used when none is given on the command line`,
    `STOP_ON_FAILURE = ${py(options.stopOnFailure)}  # stop after the first failed request`,
    `HTTP_ERRORS_FAIL = ${py(options.httpErrorsFail)}  # count 4xx and 5xx responses as failures`,
    `DELAY_MS = ${Math.max(0, Math.floor(options.delayMs) || 0)}  # pause between requests`,
    "TIMEOUT = 120  # seconds to wait for each response",
    'RESULTS_FILE = ""  # empty: <csv name>-results-<date and time>.csv',
    "DRY_RUN = False  # True prints the requests without sending them",
    "",
    "# Values for placeholders that no CSV column fills (a column with the same name wins).",
    `VALUES = ${pyValues(input)}`,
    ...(cert ? pyCertificateSettings(cert) : []),
  ].join("\n");
  return fill(
    pythonRunner,
    { HEADER: headerComment(input), FILE: scriptFileName(def, "python"), CSV: csvArg(input), SETTINGS: settings, REQUEST: pyRequest(def) },
    runnerFlags(input),
  );
}

/* ---------- Bash ---------- */

/** A bash single-quoted string. */
function sq(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

type Segment = { text: string } | { name: string; raw: string; json: boolean };

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

function hasPlaceholder(text: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/** Bash for one value: a quoted literal, or a fill call that leaves the value in $REPLY. */
function bashValue(text: string): { fill: string; ref: string } {
  return hasPlaceholder(text) ? { fill: `fill ${sq(text)}; `, ref: '"$REPLY"' } : { fill: "", ref: sq(text) };
}

/** Bash lines that add key/value rows to the arrays named keys and values. */
function bashPairs(rows: [string, string][], keys: string, values: string): string[] {
  return rows.map(([k, val]) => {
    const key = bashValue(k);
    const value = bashValue(val);
    return key.fill
      ? `  ${key.fill}k=$REPLY; ${value.fill}${keys}+=("$k"); ${values}+=(${value.ref})`
      : `  ${value.fill}${keys}+=(${key.ref}); ${values}+=(${value.ref})`;
  });
}

/** Bash lines that leave a JSON body in $REPLY: values inside JSON strings are escaped (vj). */
function bashJsonBody(body: string): string[] {
  const parts: string[] = [];
  let plain = "";
  for (const seg of jsonSegments(body)) {
    if ("name" in seg && seg.json) {
      if (plain) parts.push(`fill ${sq(plain)}`);
      parts.push(`vj ${sq(seg.name)} ${sq(seg.raw)}`);
      plain = "";
    } else {
      plain += "text" in seg ? seg.text : seg.raw;
    }
  }
  if (plain) parts.push(`fill ${sq(plain)}`);
  if (parts.length <= 1) return [`  ${parts[0] ?? "REPLY=''"}`];
  return ["  s=''", ...parts.map((part) => `  ${part}; s+=$REPLY`), "  REPLY=$s"];
}

function bashRequest(def: RequestDef): string {
  const headers = activeRows(def.headers);
  const url = bashValue(def.url);
  const lines: string[] = [
    "# Fills in the request for the current CSV row: REQ_METHOD, REQ_URL, REQ_BODY,",
    "# the headers in HK (names) and HV (values) and the query parameters in QK and QV.",
    "build_request() {",
    "  local s k",
    "  HK=(); HV=(); QK=(); QV=(); FK=(); FV=()",
    `  REQ_METHOD=${sq(def.method)}`,
    `  ${url.fill}REQ_URL=${url.ref}`,
    ...bashPairs(activeRows(def.params), "QK", "QV"),
    ...bashPairs(headers, "HK", "HV"),
  ];

  const auth = withAuthDefaults(def.auth);
  if (auth.type === "bearer" && !hasHeader(headers, "Authorization")) {
    lines.push(`  fill ${sq(auth.token)}; HK+=(Authorization); HV+=("Bearer $REPLY")`);
  } else if (auth.type === "basic" && !hasHeader(headers, "Authorization")) {
    lines.push(
      `  fill ${sq(auth.username)}; k=$REPLY; fill ${sq(auth.password)}`,
      `  HK+=(Authorization); HV+=("Basic $(printf '%s' "$k:$REPLY" | base64 | tr -d '\\r\\n')")`,
    );
  } else if (auth.type === "apikey") {
    lines.push(
      `  fill ${sq(auth.key)}; trim "$REPLY"; k=$REPLY; fill ${sq(auth.value)}`,
      auth.addTo === "header"
        ? '  if [ -n "$k" ] && ! has_header "$k"; then HK+=("$k"); HV+=("$REPLY"); fi'
        : '  if [ -n "$k" ]; then QK+=("$k"); QV+=("$REPLY"); fi',
    );
  }

  if (sendsBody(def)) {
    const type = { json: "application/json", text: "text/plain", urlencoded: "application/x-www-form-urlencoded" }[def.bodyMode as "json" | "text" | "urlencoded"];
    if (def.bodyMode === "urlencoded") {
      lines.push(...bashPairs(activeRows(def.formBody), "FK", "FV"), "  encode_pairs FK FV");
    } else if (def.bodyMode === "json") {
      lines.push(...bashJsonBody(requestBody(def)));
    } else {
      lines.push(`  fill ${sq(requestBody(def))}`);
    }
    lines.push("  REQ_BODY=$REPLY", "  REQ_HAS_BODY=1");
    if (!hasHeader(headers, "Content-Type")) lines.push(`  HK+=(Content-Type); HV+=(${sq(type)})`);
  } else {
    lines.push("  REQ_BODY=''", "  REQ_HAS_BODY=0");
  }
  lines.push("  finish_url", "}");
  return lines.join("\n");
}

function bashCertificateSettings(cert: CertificateExport): string[] {
  const client = cert.client?.client;
  const lines = ["", "# Certificates. The files stay in the app: point these at your own copies."];
  if (client) {
    lines.push(`# Client certificate "${oneLine(cert.client!.name)}".${client.hasPassphrase ? " Its passphrase is read from the REST_RUNNER_CERT_PASSPHRASE environment variable." : ""}`);
    lines.push(`CLIENT_CERT=''  # ${client.format === "pkcs12" ? "a .p12/.pfx file" : "a .pem file"}`);
    if (client.separateKey) lines.push("CLIENT_KEY=''  # the private key, PEM");
  } else {
    lines.push("CLIENT_CERT=''");
  }
  if (cert.ca) lines.push(`CA_CERT=''  # extra trusted CA from "${oneLine(cert.ca.name)}" (curl then trusts only this CA)`);
  return lines;
}

export function buildBashScript(input: ScriptExportInput): string {
  if (!isHttpMethod(input.def.method)) throw new Error("Unsupported HTTP method.");
  const { def, options } = input;
  const cert = exportedCertificate(input);
  const settings = [
    `CSV_FILE=${sq(input.csvName ?? "")}  # used when none is given on the command line`,
    `STOP_ON_FAILURE=${options.stopOnFailure ? 1 : 0}  # 1 stops after the first failed request`,
    `HTTP_ERRORS_FAIL=${options.httpErrorsFail ? 1 : 0}  # 1 counts 4xx and 5xx responses as failures`,
    `DELAY_MS=${Math.max(0, Math.floor(options.delayMs) || 0)}  # pause between requests`,
    "TIMEOUT=120  # seconds to wait for each response",
    "RESULTS_FILE=''  # empty: <csv name>-results-<date and time>.csv",
    "DRY_RUN=0  # 1 prints the requests without sending them",
    "",
    "# Values for placeholders that no CSV column fills (a column with the same name wins).",
    "default_value() {",
    '  case "$1" in',
    ...splitDefaults(input).plain.map(([k, val]) => `    ${sq(k)}) REPLY=${sq(val)} ;;`),
    ...[...splitDefaults(input).secret].map(([k, env]) => `    ${sq(k)}) REPLY=\${${env}:-} ;;`),
    "    *) return 1 ;;",
    "  esac",
    "}",
    ...(cert ? bashCertificateSettings(cert) : []),
  ].join("\n");
  return fill(
    bashRunner,
    { HEADER: headerComment(input), FILE: scriptFileName(def, "bash"), CSV: csvArg(input), SETTINGS: settings, REQUEST: bashRequest(def) },
    runnerFlags(input),
  );
}

export function buildScript(language: ScriptLanguage, input: ScriptExportInput): string {
  return language === "python" ? buildPythonScript(input) : buildBashScript(input);
}
