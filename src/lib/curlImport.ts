import { certificateForExport, type CertificateEntry } from "./certificates";
import { emptyRow, newRequest } from "./defaults";
import { newId } from "./ids";
import { formatJson, stripJsonComments } from "./jsonFormat";
import { HTTP_METHODS, type AuthConfig, type BodyMode, type HttpMethod, type KeyValue, type RequestDef } from "./types";

/** How the text was quoted: bash / zsh (single quotes, backslash) or Windows cmd (carets, double quotes). */
export type CurlDialect = "bash" | "cmd";

export interface CurlNote {
  /** "warn" is shown to the user; "info" is for things that are only worth a line in the details. */
  level: "info" | "warn";
  text: string;
}

export interface CurlCommand {
  ok: true;
  def: RequestDef;
  notes: CurlNote[];
  /** One line for the banner and the dialog list, e.g. `POST api.test/orders · 3 headers · JSON body`. */
  summary: string;
  /** 1-based line of the pasted text where this command starts. */
  line: number;
}

export interface CurlCommandError {
  ok: false;
  error: string;
  line: number;
  /** The command as it was written. */
  raw: string;
}

export type CurlParse =
  | { ok: true; dialect: CurlDialect; commands: (CurlCommand | CurlCommandError)[]; skipped: string[] }
  | { ok: false; error: string; line?: number; column?: number };

export interface CurlParseOptions {
  dialect?: CurlDialect;
  /** Used only to mention a certificate the app already has for the URL. */
  certificates?: readonly CertificateEntry[];
}

// ---------------------------------------------------------------------------------------------
// Detecting and normalising

const PROMPT = /^[ \t]*[$>][ \t]+/;
const CURL_WORD = /^curl(?:\.exe)?$/i;

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(PROMPT, ""))
    .join("\n");
}

/** True when the text starts like a curl command, so a paste can be offered for import. */
export function looksLikeCurl(text: string): boolean {
  // Comment and export lines before the first command are fine: they are skipped like those between commands.
  const first = normalize(text).split("\n").find((l) => l.trim() !== "" && !/^\s*(#|export\s|set\s)/.test(l));
  if (first === undefined) return false;
  const word = first.trim().split(/\s+/, 1)[0];
  return CURL_WORD.test(word) && /\s\S/.test(first.trim());
}

export function detectDialect(text: string): CurlDialect {
  if (/\\[ \t]*$/m.test(text)) return "bash";
  if (/\^[ \t]*$/m.test(text) || /\^"/.test(text)) return "cmd";
  return "bash";
}

// ---------------------------------------------------------------------------------------------
// Tokenising. Both dialects end up as logical lines of tokens; `at` is an offset into the normalised text.

interface Tok {
  text: string;
  at: number;
}

interface LogicalLine {
  tokens: Tok[];
  /** Offsets of the first and last character of the line in the normalised text. */
  from: number;
  to: number;
  comment: boolean;
}

class QuoteError extends Error {
  constructor(readonly at: number) {
    super("unclosed quote");
  }
}

const HEX = /^[0-9a-fA-F]+$/;

/** Reads an ANSI-C `$'…'` string starting after the opening quote. Returns the text and the offset after the closing quote. */
function readAnsiC(src: string, start: number, openAt: number): [string, number] {
  let out = "";
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'") return [out, i + 1];
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    const n = src[i + 1];
    i += 2;
    switch (n) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "a": out += "\x07"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "e": case "E": out += "\x1b"; break;
      case "\\": case "'": case '"': case "?": out += n; break;
      case "x": case "u": case "U": {
        const max = n === "x" ? 2 : n === "u" ? 4 : 8;
        let hex = "";
        while (hex.length < max && i < src.length && HEX.test(src[i])) hex += src[i++];
        if (hex === "") out += "\\" + n;
        else out += String.fromCodePoint(parseInt(hex, 16));
        break;
      }
      case undefined: out += "\\"; break;
      default:
        if (/[0-7]/.test(n)) {
          let oct = n;
          while (oct.length < 3 && /[0-7]/.test(src[i] ?? "")) oct += src[i++];
          out += String.fromCharCode(parseInt(oct, 8));
        } else {
          out += "\\" + n;
        }
    }
  }
  throw new QuoteError(openAt);
}

function tokenizeBash(src: string): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let i = 0;
  let cur: LogicalLine | null = null;
  const finish = (to: number) => {
    if (cur) {
      cur.to = to;
      lines.push(cur);
      cur = null;
    }
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") {
      finish(i);
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === "\\" && src[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (!cur) cur = { tokens: [], from: i, to: i, comment: false };
    if (ch === "#" && cur.tokens.length === 0) {
      cur.comment = true;
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    // A word: adjacent quoted and unquoted parts join into one token.
    const at = i;
    let text = "";
    while (i < src.length) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\n") break;
      if (c === "\\") {
        if (src[i + 1] === "\n") {
          i += 2; // a line joined inside a word
        } else if (i + 1 < src.length) {
          text += src[i + 1];
          i += 2;
        } else {
          text += "\\";
          i += 1;
        }
      } else if (c === "'") {
        const close = src.indexOf("'", i + 1);
        if (close < 0) throw new QuoteError(i);
        text += src.slice(i + 1, close);
        i = close + 1;
      } else if (c === "$" && src[i + 1] === "'") {
        const [s, next] = readAnsiC(src, i + 2, i);
        text += s;
        i = next;
      } else if (c === '"') {
        const open = i;
        i += 1;
        for (;;) {
          if (i >= src.length) throw new QuoteError(open);
          const d = src[i];
          if (d === '"') {
            i += 1;
            break;
          }
          if (d === "\\" && i + 1 < src.length) {
            const e = src[i + 1];
            if (e === "\n") {
              i += 2;
            } else if (e === '"' || e === "\\" || e === "$" || e === "`") {
              text += e;
              i += 2;
            } else {
              text += "\\";
              i += 1;
            }
          } else {
            text += d;
            i += 1;
          }
        }
      } else {
        text += c;
        i += 1;
      }
    }
    cur.tokens.push({ text, at });
  }
  finish(src.length);
  return lines;
}

/**
 * Windows cmd. First cmd's own pass: outside double quotes ^ escapes the next character and a ^ at
 * the end of a line joins it to the next. Then the C runtime rules curl.exe uses to split the
 * result into arguments. `map` keeps each resulting character's offset in the original text.
 */
function decodeCmd(src: string): { chars: string; map: number[] } {
  let chars = "";
  const map: number[] = [];
  const push = (c: string, at: number) => {
    chars += c;
    map.push(at);
  };
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "^" && !inQuotes) {
      const n = src[i + 1];
      if (n === undefined) break;
      if (n === "\n") {
        i += 1;
        continue;
      }
      push(n, i + 1); // an escaped quote does not flip cmd's quote state
      i += 1;
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    push(ch, i);
  }
  return { chars, map };
}

function tokenizeCmd(src: string): LogicalLine[] {
  const { chars, map } = decodeCmd(src);
  const lines: LogicalLine[] = [];
  let cur: LogicalLine | null = null;
  let i = 0;
  const finish = (to: number) => {
    if (cur) {
      cur.to = to;
      lines.push(cur);
      cur = null;
    }
  };
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === "\n") {
      finish(map[i]);
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (!cur) cur = { tokens: [], from: map[i], to: map[i], comment: false };
    if (ch === "#" && cur.tokens.length === 0) {
      cur.comment = true;
      while (i < chars.length && chars[i] !== "\n") i += 1;
      continue;
    }
    const at = map[i];
    let text = "";
    let inQuotes = false;
    let openAt = at;
    while (i < chars.length) {
      const c = chars[i];
      if (!inQuotes && (c === " " || c === "\t" || c === "\n")) break;
      if (c === "\\") {
        let slashes = 0;
        while (chars[i] === "\\") {
          slashes += 1;
          i += 1;
        }
        if (chars[i] === '"') {
          text += "\\".repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            text += '"';
            i += 1;
          }
        } else {
          text += "\\".repeat(slashes);
        }
      } else if (c === '"') {
        if (inQuotes && chars[i + 1] === '"') {
          text += '"';
          i += 2;
        } else {
          if (!inQuotes) openAt = map[i];
          inQuotes = !inQuotes;
          i += 1;
        }
      } else {
        text += c;
        i += 1;
      }
    }
    if (inQuotes) throw new QuoteError(openAt);
    cur.tokens.push({ text, at });
  }
  finish(src.length);
  return lines;
}

function lineAndColumn(src: string, at: number): { line: number; column: number } {
  const before = src.slice(0, at);
  const line = before.split("\n").length;
  return { line, column: at - (before.lastIndexOf("\n") + 1) + 1 };
}

// ---------------------------------------------------------------------------------------------
// Flags

/** Options that take a value, by long name. Short flags are mapped to these. */
const SHORT_WITH_VALUE: Record<string, string> = {
  X: "request", H: "header", d: "data", u: "user", A: "user-agent", e: "referer", b: "cookie", F: "form",
  m: "max-time", x: "proxy", o: "output", T: "upload-file", w: "write-out", E: "cert", c: "cookie-jar",
  D: "dump-header", U: "proxy-user", r: "range", z: "time-cond", C: "continue-at", K: "config", Y: "speed-limit", y: "speed-time",
};
const SHORT_NO_VALUE: Record<string, string> = {
  I: "head", G: "get", k: "insecure", s: "silent", S: "show-error", v: "verbose", L: "location", i: "include",
  O: "remote-name", f: "fail", g: "globoff", "0": "http1.0", "1": "tlsv1", "2": "sslv2", "3": "sslv3", "4": "ipv4", "6": "ipv6",
  "#": "progress-bar", N: "no-buffer", l: "list-only", j: "junk-session-cookies", B: "use-ascii", a: "append", n: "netrc", q: "disable", Z: "parallel", p: "proxytunnel", R: "remote-time", J: "remote-header-name",
};

/** Long options with a value that are ignored; the value is consumed. */
const LONG_VALUE_IGNORED = new Set([
  "max-time", "connect-timeout", "retry", "retry-delay", "retry-max-time", "write-out", "max-redirs", "limit-rate", "range",
  "dump-header", "cookie-jar", "keepalive-time", "interface", "ciphers", "proto", "time-cond", "continue-at", "speed-limit", "speed-time", "config",
  "expect100-timeout", "trace", "trace-ascii", "stderr", "tls-max", "tlsv1.3-ciphers", "curves", "dns-servers", "doh-url", "happy-eyeballs-timeout-ms", "local-port", "max-filesize", "noproxy", "proxy-header", "referer-url",
]);
const LONG_NO_VALUE_IGNORED = new Set([
  "compressed", "silent", "show-error", "verbose", "location", "location-trusted", "include", "http1.1", "http1.0", "http2", "http2-prior-knowledge", "http3", "fail", "fail-with-body",
  "globoff", "no-buffer", "progress-bar", "tlsv1", "tlsv1.0", "tlsv1.1", "tlsv1.2", "tlsv1.3", "ipv4", "ipv6", "no-keepalive", "tcp-nodelay", "path-as-is", "styled-output", "no-progress-meter", "anyauth", "basic",
  "disable", "remote-time", "raw", "compressed-ssh", "ssl-no-revoke", "ssl", "ssl-reqd", "tr-encoding", "junk-session-cookies", "use-ascii", "append", "list-only", "netrc", "parallel", "retry-connrefused", "retry-all-errors", "suppress-connect-headers", "progress-meter",
]);
const CERT_OPTIONS = new Set(["cert", "key", "cacert", "capath", "pass", "cert-type", "key-type", "cert-status", "proxy-cacert"]);
const LONG_VALUE_UNSUPPORTED = new Set(["proxy", "resolve", "connect-to", "output", "upload-file", "proxy-user", "unix-socket"]);
const NO_VALUE_UNSUPPORTED = new Set(["remote-name", "remote-header-name", "proxytunnel"]);
const LONG_VALUE_ALL = new Set([
  "request", "header", "data", "data-ascii", "data-raw", "data-binary", "data-urlencode", "json", "user", "user-agent", "referer", "cookie", "form", "form-string", "url",
  ...CERT_OPTIONS, ...LONG_VALUE_IGNORED, ...LONG_VALUE_UNSUPPORTED,
]);
// cert-status takes no value.
LONG_VALUE_ALL.delete("cert-status");

interface Flag {
  name: string;
  value: string | null;
}

/** Splits the tokens after `curl` into flags and bare words (URLs). Unknown flags are returned with no value. */
function readFlags(tokens: Tok[], notes: CurlNote[]): { flags: Flag[]; words: string[] } {
  const flags: Flag[] = [];
  const words: string[] = [];
  let i = 0;
  const takeValue = (name: string): string | null => {
    if (i + 1 < tokens.length) {
      i += 1;
      return tokens[i].text;
    }
    notes.push({ level: "warn", text: `The option --${name} had no value, so it was ignored.` });
    return null;
  };
  for (; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (t === "--") {
      for (i += 1; i < tokens.length; i++) words.push(tokens[i].text);
      break;
    }
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const name = eq > 0 ? t.slice(2, eq) : t.slice(2);
      if (LONG_VALUE_ALL.has(name)) {
        const value = eq > 0 ? t.slice(eq + 1) : takeValue(name);
        if (value !== null) flags.push({ name, value });
      } else {
        flags.push({ name, value: null });
      }
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      for (let j = 1; j < t.length; j++) {
        const c = t[j];
        const longName = SHORT_WITH_VALUE[c];
        if (longName) {
          const attached = t.slice(j + 1);
          const value = attached !== "" ? attached : takeValue(longName);
          if (value !== null) flags.push({ name: longName, value });
          break;
        }
        flags.push({ name: SHORT_NO_VALUE[c] ?? `-${c}`, value: null });
      }
      continue;
    }
    words.push(t);
  }
  return { flags, words };
}

// ---------------------------------------------------------------------------------------------
// Building the request

function kv(key: string, value: string): KeyValue {
  return { id: newId(), key, value, enabled: true };
}

function decodeComponent(s: string): string {
  const plus = s.replace(/\+/g, " ");
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}

/** `a=1&b=2` into pairs, decoded. A part with no `=` is a key with an empty value. */
function parsePairs(text: string): [string, string][] {
  return text
    .split("&")
    .filter((p) => p !== "")
    .map((p) => {
      const eq = p.indexOf("=");
      return eq < 0 ? [decodeComponent(p), ""] : [decodeComponent(p.slice(0, eq)), decodeComponent(p.slice(eq + 1))];
    });
}

function isPairList(text: string): boolean {
  const parts = text.split("&").filter((p) => p !== "");
  return parts.length > 0 && parts.every((p) => /^[^=]+=/.test(p));
}

function hasHeaderRow(rows: KeyValue[], name: string): boolean {
  const lower = name.toLowerCase();
  return rows.some((r) => r.key.toLowerCase() === lower);
}

function headerValue(rows: KeyValue[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return rows.find((r) => r.key.toLowerCase() === lower)?.value;
}

function decodeBasic(b64: string): { username: string; password: string } | null {
  try {
    const bin = atob(b64.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const colon = text.indexOf(":");
    if (colon < 0) return null;
    return { username: text.slice(0, colon), password: text.slice(colon + 1) };
  } catch {
    return null;
  }
}

function splitUrl(raw: string): { url: string; query: string } {
  const noFragment = raw.replace(/#.*$/s, "");
  const q = noFragment.indexOf("?");
  return q < 0 ? { url: noFragment, query: "" } : { url: noFragment.slice(0, q), query: noFragment.slice(q + 1) };
}

function nameFor(method: HttpMethod, url: string): string {
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const slash = rest.indexOf("/");
  const host = slash < 0 ? rest : rest.slice(0, slash);
  const segments = (slash < 0 ? "" : rest.slice(slash)).split("/").filter((s) => s !== "");
  const last = segments[segments.length - 1];
  let label = host;
  if (last !== undefined) {
    try {
      label = decodeURIComponent(last);
    } catch {
      label = last;
    }
  }
  return `${method} ${label || "request"}`;
}

function summarize(def: RequestDef): string {
  const rest = def.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const parts = [`${def.method} ${rest}`];
  const headers = def.headers.filter((h) => h.key.trim() !== "").length;
  if (headers > 0) parts.push(`${headers} header${headers === 1 ? "" : "s"}`);
  if (def.bodyMode === "json") parts.push("JSON body");
  else if (def.bodyMode === "urlencoded") parts.push("form body");
  else if (def.bodyMode === "text") parts.push("text body");
  if (def.auth.type === "bearer") parts.push("Bearer token");
  else if (def.auth.type === "basic") parts.push("Basic auth");
  return parts.join(" · ");
}

function buildCommand(tokens: Tok[], line: number, raw: string, options: CurlParseOptions): CurlCommand | CurlCommandError {
  const notes: CurlNote[] = [];
  const warn = (text: string) => {
    if (!notes.some((n) => n.text === text)) notes.push({ level: "warn", text });
  };
  const fail = (error: string): CurlCommandError => ({ ok: false, error, line, raw });

  const { flags, words } = readFlags(tokens.slice(1), notes);

  let urlText: string | null = null;
  let explicitMethod: string | null = null;
  let head = false;
  let getMode = false;
  const headerRows: KeyValue[] = [];
  const dataParts: string[] = [];
  let jsonParts: string[] | null = null;
  const urlencodeRows: KeyValue[] = [];
  const formRows: KeyValue[] = [];
  let user: string | null = null;
  let cookie: string | null = null;
  let userAgent: string | null = null;
  let referer: string | null = null;
  let multipart = false;
  let hasDataFlag = false;

  for (const f of flags) {
    const v = f.value ?? "";
    switch (f.name) {
      case "url":
        if (urlText === null) urlText = v;
        else warn("More than one URL was given. Only the first is used.");
        break;
      case "request":
        explicitMethod = v;
        break;
      case "head":
        head = true;
        break;
      case "get":
        getMode = true;
        break;
      case "header": {
        const colon = v.indexOf(":");
        if (colon < 0) {
          if (v.trim().endsWith(";")) headerRows.push(kv(v.trim().slice(0, -1).trim(), ""));
          else warn(`The header "${v}" has no colon, so it was ignored.`);
        } else {
          const name = v.slice(0, colon).trim();
          const value = v.slice(colon + 1).trim();
          if (name === "") break;
          if (value === "") notes.push({ level: "info", text: `"${name}:" asks curl to remove that header, so it was left out.` });
          else headerRows.push(kv(name, value));
        }
        break;
      }
      case "user":
        user = v;
        break;
      case "digest":
      case "ntlm":
      case "negotiate":
      case "anyauth":
        warn(`Authentication with --${f.name} isn't supported. The request has no auth set.`);
        break;
      case "data":
      case "data-ascii":
      case "data-binary":
      case "data-raw": {
        hasDataFlag = true;
        const raw = f.name === "data-raw";
        if (!raw && v.startsWith("@")) {
          warn("File bodies aren't supported: the body read from a file was left empty.");
          break;
        }
        dataParts.push(f.name === "data" || f.name === "data-ascii" ? v.replace(/[\r\n]/g, "") : v);
        break;
      }
      case "json":
        hasDataFlag = true;
        if (v.startsWith("@")) warn("File bodies aren't supported: the body read from a file was left empty.");
        else (jsonParts ??= []).push(v);
        break;
      case "data-urlencode": {
        hasDataFlag = true;
        const eq = v.indexOf("=");
        const at = v.indexOf("@");
        if (eq < 0 && at > 0) warn("A --data-urlencode value read from a file was left out.");
        else if (eq < 0) warn("A --data-urlencode value with no name was left out.");
        else if (eq === 0) warn("A --data-urlencode value with no name was left out.");
        else urlencodeRows.push(kv(v.slice(0, eq), v.slice(eq + 1)));
        break;
      }
      case "form":
      case "form-string": {
        hasDataFlag = true;
        multipart = true;
        const eq = v.indexOf("=");
        if (eq <= 0) {
          warn(`The form field "${v}" has no name=value, so it was left out.`);
          break;
        }
        const value = v.slice(eq + 1);
        if (f.name === "form" && (value.startsWith("@") || value.startsWith("<"))) {
          warn(`The form field "${v.slice(0, eq)}" uploads a file, which isn't supported, so it was left out.`);
          break;
        }
        formRows.push(kv(v.slice(0, eq), f.name === "form" ? value.replace(/;type=[^;]*$/, "") : value));
        break;
      }
      case "cookie":
        if (v.includes("=")) cookie = cookie === null ? v : `${cookie}; ${v}`;
        else warn("A cookie jar file was given instead of cookies, so it was left out.");
        break;
      case "user-agent":
        userAgent = v;
        break;
      case "referer":
        referer = v;
        break;
      case "insecure":
        warn("REST Runner always checks certificates. Add the server's CA under Certificates instead of skipping the check.");
        break;
      default:
        if (CERT_OPTIONS.has(f.name)) {
          warn("Certificates are set up under Certificates, not on each request.");
        } else if (LONG_VALUE_UNSUPPORTED.has(f.name) || NO_VALUE_UNSUPPORTED.has(f.name)) {
          warn(`--${f.name} isn't supported, so it was ignored.`);
        } else if (LONG_VALUE_IGNORED.has(f.name) || LONG_NO_VALUE_IGNORED.has(f.name)) {
          // Settings that don't change the request itself.
        } else if (!Object.values(SHORT_NO_VALUE).includes(f.name) && !Object.values(SHORT_WITH_VALUE).includes(f.name)) {
          warn(`The option ${f.name.startsWith("-") ? f.name : `--${f.name}`} isn't recognised, so it was ignored.`);
        }
    }
  }

  if (urlText === null) urlText = words.shift() ?? null;
  if (words.length > 0) warn("More than one URL was given. Only the first is used.");
  if (urlText === null || urlText.trim() === "") return fail("No URL found in this command.");

  // Method.
  let method: HttpMethod;
  if (explicitMethod !== null) {
    const m = explicitMethod.toUpperCase();
    if (!(HTTP_METHODS as readonly string[]).includes(m)) return fail(`The method ${explicitMethod} isn't supported. REST Runner sends ${HTTP_METHODS.join(", ")}.`);
    method = m as HttpMethod;
  } else if (head) {
    method = "HEAD";
  } else if (hasDataFlag && !getMode) {
    method = "POST";
  } else {
    method = "GET";
  }

  // URL and query string.
  const { url, query } = splitUrl(urlText.trim());
  const params: KeyValue[] = parsePairs(query).map(([k, v]) => kv(k, v));
  if (getMode) {
    const pairs = [...dataParts.flatMap((p) => parsePairs(p)), ...urlencodeRows.map((r): [string, string] => [r.key, r.value])];
    for (const [k, v] of pairs) params.push(kv(k, v));
  }

  // Headers.
  const headers = headerRows;
  if (cookie !== null) {
    const existing = headers.find((h) => h.key.toLowerCase() === "cookie");
    if (existing) existing.value = `${existing.value}; ${cookie}`;
    else headers.push(kv("Cookie", cookie));
  }
  if (userAgent !== null && !hasHeaderRow(headers, "User-Agent")) headers.push(kv("User-Agent", userAgent));
  if (referer !== null && !hasHeaderRow(headers, "Referer")) headers.push(kv("Referer", referer));

  // Auth.
  let auth: AuthConfig = { type: "none" };
  if (user !== null) {
    const colon = user.indexOf(":");
    if (colon < 0) notes.push({ level: "info", text: "The user name had no password, so the password is empty." });
    auth = { type: "basic", username: colon < 0 ? user : user.slice(0, colon), password: colon < 0 ? "" : user.slice(colon + 1) };
  } else {
    const idx = headers.findIndex((h) => h.key.toLowerCase() === "authorization");
    if (idx >= 0) {
      const value = headers[idx].value;
      const bearer = /^Bearer\s+(.+)$/i.exec(value);
      const basic = /^Basic\s+(.+)$/i.exec(value);
      const creds = basic ? decodeBasic(basic[1]) : null;
      if (bearer) {
        auth = { type: "bearer", token: bearer[1].trim() };
        headers.splice(idx, 1);
      } else if (creds) {
        auth = { type: "basic", ...creds };
        headers.splice(idx, 1);
      }
    }
  }

  // Body.
  let bodyMode: BodyMode = "none";
  let body = "";
  let formBody: KeyValue[] = [];
  const contentType = headerValue(headers, "Content-Type") ?? "";
  const dropContentType = (value: string) => {
    const i = headers.findIndex((h) => h.key.toLowerCase() === "content-type" && h.value.trim().toLowerCase() === value);
    if (i >= 0) headers.splice(i, 1);
  };

  if (!getMode) {
    if (formRows.length > 0 || urlencodeRows.length > 0) {
      bodyMode = "urlencoded";
      formBody = [...(dataParts.length > 0 ? parsePairs(dataParts.join("&")).map(([k, v]) => kv(k, v)) : []), ...urlencodeRows, ...formRows];
      if (multipart) warn("A multipart form (-F) was turned into an urlencoded form body. Servers that need multipart won't accept it.");
      if (/multipart\/form-data/i.test(contentType)) {
        const i = headers.findIndex((h) => h.key.toLowerCase() === "content-type");
        if (i >= 0) headers.splice(i, 1); // its boundary belongs to the old body
      }
    } else if (jsonParts !== null) {
      bodyMode = "json";
      body = jsonParts.join("");
      if (!hasHeaderRow(headers, "Content-Type")) headers.push(kv("Content-Type", "application/json"));
      if (!hasHeaderRow(headers, "Accept")) headers.push(kv("Accept", "application/json"));
    } else if (dataParts.length > 0) {
      body = dataParts.join("&");
      if (body !== "") {
        let json = false;
        try {
          const parsed: unknown = JSON.parse(stripJsonComments(body));
          json = typeof parsed === "object" && parsed !== null;
        } catch {
          json = false;
        }
        if (json || /json/i.test(contentType)) {
          bodyMode = "json";
        } else if (isPairList(body) && (contentType === "" || /x-www-form-urlencoded/i.test(contentType))) {
          bodyMode = "urlencoded";
          formBody = parsePairs(body).map(([k, v]) => kv(k, v));
          body = "";
        } else {
          bodyMode = "text";
          // curl sends -d data as a form unless told otherwise.
          if (contentType === "") headers.push(kv("Content-Type", "application/x-www-form-urlencoded"));
        }
      }
    }
  } else if (jsonParts !== null || formRows.length > 0) {
    // -G only moves --data values into the query; --json and -F have no query form.
    warn("--get was combined with a body option, so the body was left out.");
  }

  if (bodyMode === "json") {
    body = formatJson(body) ?? body;
    dropContentType("application/json");
  } else if (bodyMode === "urlencoded") {
    dropContentType("application/x-www-form-urlencoded");
  }

  if ((method === "GET" || method === "HEAD") && (body !== "" || formBody.some((r) => r.key !== ""))) {
    warn(`A ${method} request doesn't send a body, so the body is kept in the editor but won't be sent.`);
  }

  // Certificate hint.
  if (options.certificates && options.certificates.length > 0) {
    const cert = certificateForExport(urlText, options.certificates);
    const name = cert?.client?.name ?? cert?.ca?.name;
    if (name) notes.push({ level: "info", text: `The certificate "${name}" already applies to this URL.` });
  }

  const def: RequestDef = {
    ...newRequest(),
    name: nameFor(method, url),
    method,
    url,
    params: [...params, emptyRow()],
    headers: [...headers, emptyRow()],
    bodyMode,
    body,
    formBody: [...formBody, emptyRow()],
    auth,
  };
  return { ok: true, def, notes, summary: summarize(def), line };
}

// ---------------------------------------------------------------------------------------------
// Entry point

/** Turns pasted text into zero or more requests. Pure: no storage, no network, no React. */
export function parseCurl(text: string, options: CurlParseOptions = {}): CurlParse {
  const src = normalize(text);
  const dialect = options.dialect ?? detectDialect(src);
  let lines: LogicalLine[];
  try {
    lines = dialect === "bash" ? tokenizeBash(src) : tokenizeCmd(src);
  } catch (e) {
    if (e instanceof QuoteError) {
      const { line, column } = lineAndColumn(src, e.at);
      return { ok: false, error: `A quote opened on line ${line}, column ${column} is never closed.`, line, column };
    }
    throw e;
  }

  const commands: (CurlCommand | CurlCommandError)[] = [];
  const skipped: string[] = [];
  for (const l of lines) {
    const raw = src.slice(l.from, l.to).trim();
    if (!l.comment && l.tokens.length > 0 && CURL_WORD.test(l.tokens[0].text)) {
      commands.push(buildCommand(l.tokens, lineAndColumn(src, l.from).line, raw, options));
    } else if (raw !== "") {
      skipped.push(raw);
    }
  }
  if (commands.length === 0) return { ok: false, error: "No curl command found in this text." };
  return { ok: true, dialect, commands, skipped };
}
