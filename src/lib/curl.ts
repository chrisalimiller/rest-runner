import { prepareRequest } from "./request";
import { findPlaceholders, type Vars } from "./template";
import type { PreparedRequest, RequestDef } from "./types";

/** The terminal the command is written for. */
export type CurlShell = "bash" | "cmd";

export const CURL_SHELL_LABELS: Record<CurlShell, string> = {
  bash: "Bash / zsh",
  cmd: "Windows cmd",
};

export interface CurlResult {
  command: string;
  /** {{placeholders}} that had no value, so they are still in the command as written. */
  unresolved: string[];
  /** Things the user should know about this command, e.g. a body that had to be changed for cmd. */
  notes: string[];
}

/** Bash / zsh: single quotes keep everything literal; a ' inside becomes '\''. */
export function bashQuote(arg: string): string {
  if (arg !== "" && /^[A-Za-z0-9_\-./:=@%+,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Windows cmd running curl.exe. Two parsers read the line: curl.exe splits arguments with
 * the C runtime rules (" is written \", and backslashes before a quote are doubled), then
 * cmd treats & | < > ^ ( ) as special wherever it thinks it is outside quotes. cmd flips its
 * quote state on every ", escaped or not, so those characters get a ^ where cmd would see them.
 */
export function cmdQuote(arg: string): string {
  let crt = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      slashes += 1;
      continue;
    }
    if (ch === '"') {
      crt += "\\".repeat(slashes * 2) + '\\"';
    } else {
      crt += "\\".repeat(slashes) + ch;
    }
    slashes = 0;
  }
  crt += "\\".repeat(slashes * 2) + '"';

  let out = "";
  let inQuotes = false;
  for (const ch of crt) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && /[&|<>^()]/.test(ch)) out += "^";
    out += ch;
  }
  return out;
}

/** cmd cannot pass a line break inside an argument. JSON bodies are put on one line instead. */
function bodyForCmd(body: string, isJson: boolean): { body: string; note?: string; broken?: boolean } {
  if (!/[\r\n]/.test(body)) return { body };
  if (isJson) {
    try {
      return { body: JSON.stringify(JSON.parse(body)), note: "The JSON body is put on one line, because cmd can't pass line breaks. It means the same thing." };
    } catch {
      // Not valid JSON; fall through.
    }
  }
  return { body: body.replace(/\r?\n/g, " "), broken: true };
}

function headerArg(name: string, value: string): string {
  // curl drops a header given as "Name:", so an empty value is written "Name;".
  return value === "" ? `${name};` : `${name}: ${value}`;
}

/** Builds the curl command for a request that is already prepared (placeholders filled, auth applied). */
export function preparedToCurl(req: PreparedRequest, shell: CurlShell, isJsonBody = false): Omit<CurlResult, "unresolved"> {
  const quote = shell === "bash" ? bashQuote : cmdQuote;
  const notes: string[] = [];
  const first = ["curl", "--location"];
  if (req.method === "HEAD") first.push("--head");
  else if (req.method !== "GET") first.push("--request", req.method);
  first.push(quote(req.url));

  const lines = [first.join(" ")];
  for (const [k, v] of req.headers) lines.push(`--header ${quote(headerArg(k, v))}`);
  if (req.body !== undefined && req.body !== "") {
    let body = req.body;
    if (shell === "cmd") {
      const fixed = bodyForCmd(body, isJsonBody);
      body = fixed.body;
      if (fixed.note) notes.push(fixed.note);
      if (fixed.broken) notes.push("Line breaks in the body were turned into spaces, because cmd can't pass them. Use the Bash version to send the body exactly.");
    }
    lines.push(`--data-raw ${quote(body)}`);
  }
  const join = shell === "bash" ? " \\\n  " : " ^\n  ";
  return { command: lines.join(join), notes };
}

/** The curl command Send would run for this request, with environment and script variables filled in. */
export function requestToCurl(def: RequestDef, vars: Vars, shell: CurlShell): CurlResult {
  const prepared = prepareRequest(def, vars);
  const { command, notes } = preparedToCurl(prepared, shell, def.bodyMode === "json");
  const texts = [prepared.url, ...prepared.headers.flat(), prepared.body ?? ""];
  const unresolved = [...new Set(texts.flatMap(findPlaceholders))];
  if ((def.preScript ?? "").trim() !== "") {
    notes.push("This request has a pre-request script. Anything it changes when you press Send is not in this command.");
  }
  return { command, unresolved, notes };
}
