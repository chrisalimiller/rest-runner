import { requestNode, type Collection, type FolderNode, type TreeNode } from "./collections";
import { emptyRow } from "./defaults";
import type { Environment } from "./environments";
import { newId } from "./ids";
import { HTTP_METHODS, type AuthConfig, type BodyMode, type HttpMethod, type KeyValue, type RequestDef } from "./types";

/**
 * Parsers for the file formats the Import dialog understands besides Postman and REST Runner's own:
 * Insomnia exports, Bruno collections and environments, and .env files. Pure functions: they never
 * touch storage, and what cannot be carried over is reported in `warnings`.
 */

type Json = Record<string, unknown>;

export interface ParsedEnvironment {
  environment: Environment;
  warnings: string[];
}

function isObj(x: unknown): x is Json {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string {
  if (typeof x === "string") return x;
  if (x === null || x === undefined) return "";
  return typeof x === "object" ? JSON.stringify(x) : String(x);
}

function kv(key: string, value: string, enabled = true): KeyValue {
  return { id: newId(), key, value, enabled };
}

function rowsOrEmpty(list: KeyValue[]): KeyValue[] {
  return list.length > 0 ? list : [emptyRow()];
}

function envOf(name: string, vars: KeyValue[]): Environment {
  return { id: newId(), name, vars: rowsOrEmpty(vars) };
}

// ---- Secret-looking names ---------------------------------------------------

const SECRET_WORDS = new Set(["token", "tokens", "key", "keys", "secret", "secrets", "password", "passwd", "pwd", "pass", "apikey", "credential", "credentials", "bearer", "jwt", "passphrase", "signature"]);
const SECRET_SUFFIXES = ["secret", "token", "password", "passwd", "apikey", "passphrase"];

/** True when a variable name looks like it holds a secret: token, key, secret, password and similar words. */
export function looksSecret(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return words.some((w) => SECRET_WORDS.has(w) || SECRET_SUFFIXES.some((s) => w.length > s.length && w.endsWith(s)));
}

/** Marks secret-looking variables (those with a value or not) as secret. Variables already secret stay secret. */
export function markSecretLooking(env: Environment): Environment {
  return { ...env, vars: env.vars.map((v) => (v.secret || (v.key.trim() !== "" && looksSecret(v.key)) ? { ...v, secret: true } : v)) };
}

// ---- .env files -----------------------------------------------------------

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

/** True when every non-blank, non-comment line is KEY=VALUE and there is at least one. */
export function looksLikeDotEnv(text: string): boolean {
  let found = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    if (!ENV_LINE.test(line)) return false;
    found += 1;
  }
  return found > 0;
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"');
    if (end > 0) return v.slice(1, end).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'");
    if (end > 0) return v.slice(1, end);
  }
  // Unquoted: a trailing " # comment" is not part of the value.
  return v.replace(/\s+#.*$/, "").trim();
}

/** A friendly environment name from a file name: ".env.production" is "production", ".env" is "Imported .env". */
export function envNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const m = /^\.env\.(.+)$/i.exec(base) ?? /^(.+)\.env$/i.exec(base);
  if (m && m[1].trim() !== "") return m[1];
  return base.toLowerCase() === ".env" || base === "" ? "Imported .env" : base.replace(/\.[^.]+$/, "");
}

/** Reads a .env file into an environment. Later duplicates of a key win. */
export function parseDotEnv(text: string, name: string): ParsedEnvironment {
  const byKey = new Map<string, string>();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = ENV_LINE.exec(line);
    if (m) byKey.set(m[1], unquote(m[2]));
  }
  const warnings: string[] = [];
  if (byKey.size === 0) throw new Error("This file has no KEY=VALUE lines.");
  if ([...byKey.values()].some((v) => /\$\{?[A-Za-z_]/.test(v))) warnings.push("Some values refer to other variables with $NAME; they were kept as written.");
  return { environment: envOf(name, [...byKey].map(([k, v]) => kv(k, v))), warnings };
}

// ---- Bruno environment (.bru) -----------------------------------------------

/** True for the text of a Bruno environment file: a `vars {` block and no request blocks. */
export function looksLikeBrunoEnvironment(text: string): boolean {
  return /^\s*vars\s*\{/m.test(text) && !/^\s*(get|post|put|patch|delete|head|options)\s*\{/im.test(text) && !/^\s*meta\s*\{/m.test(text);
}

/** Reads a Bruno environment: `vars { name: value }` plus `vars:secret [ name, ... ]`. A `~` prefix means disabled. */
export function parseBrunoEnvironment(text: string, name: string): ParsedEnvironment {
  const vars: KeyValue[] = [];
  const block = /^\s*vars\s*\{([\s\S]*?)^\}/m.exec(text);
  if (block) {
    for (const line of block[1].split(/\r?\n/)) {
      const t = line.trim();
      if (t === "") continue;
      const colon = t.indexOf(":");
      if (colon <= 0) continue;
      let key = t.slice(0, colon).trim();
      const enabled = !key.startsWith("~");
      if (!enabled) key = key.slice(1);
      vars.push(kv(key, t.slice(colon + 1).trim(), enabled));
    }
  }
  const secrets = /^\s*vars:secret\s*\[([\s\S]*?)\]/m.exec(text);
  if (secrets) {
    for (const part of secrets[1].split(/[\r\n,]+/)) {
      let key = part.trim();
      if (key === "") continue;
      const enabled = !key.startsWith("~");
      if (!enabled) key = key.slice(1);
      vars.push({ ...kv(key, "", enabled), secret: true });
    }
  }
  if (vars.length === 0) throw new Error("This Bruno environment has no variables.");
  const warnings = secrets ? ["Bruno does not store secret values in the file, so the secret variables are empty. Fill them in after importing."] : [];
  return { environment: envOf(name, vars), warnings };
}

// ---- Bruno collection (JSON export) -------------------------------------

export function isBrunoCollection(data: unknown): boolean {
  if (!isObj(data) || !Array.isArray(data.items) || isObj(data.info)) return false;
  if (isObj(data.brunoConfig) || Array.isArray(data.environments)) return true;
  return data.items.some((i) => isObj(i) && typeof i.type === "string" && /^(http|graphql)-request$|^folder$/.test(i.type));
}

export interface ParsedCollections {
  collections: Collection[];
  environments: Environment[];
  warnings: string[];
}

function methodOf(raw: unknown, where: string, warnings: string[]): HttpMethod | null {
  const m = (typeof raw === "string" ? raw : "GET").toUpperCase();
  if ((HTTP_METHODS as readonly string[]).includes(m)) return m as HttpMethod;
  warnings.push(`${where}: the ${m} method is not supported, so the request was skipped.`);
  return null;
}

function brunoRows(x: unknown, filter?: (r: Json) => boolean): KeyValue[] {
  if (!Array.isArray(x)) return [];
  return x.filter(isObj).filter((r) => (filter ? filter(r) : true)).map((r) => kv(str(r.name), str(r.value), r.enabled !== false));
}

function brunoAuth(auth: unknown, where: string, warnings: string[]): AuthConfig {
  if (!isObj(auth) || typeof auth.mode !== "string" || auth.mode === "none" || auth.mode === "inherit") return { type: "none" };
  if (auth.mode === "bearer" && isObj(auth.bearer)) return { type: "bearer", token: str(auth.bearer.token) };
  if (auth.mode === "basic" && isObj(auth.basic)) return { type: "basic", username: str(auth.basic.username), password: str(auth.basic.password) };
  if (auth.mode === "apikey" && isObj(auth.apikey)) {
    return { type: "apikey", key: str(auth.apikey.key), value: str(auth.apikey.value), addTo: auth.apikey.placement === "queryparams" ? "query" : "header" };
  }
  warnings.push(`${where}: "${auth.mode}" authorization is not supported, so it was imported without auth.`);
  return { type: "none" };
}

/** Converts a Bruno collection export (the JSON file Bruno writes with Export collection). */
export function parseBrunoCollection(data: unknown): ParsedCollections {
  if (!isBrunoCollection(data)) throw new Error("This is not a Bruno collection export.");
  const d = data as Json;
  const warnings: string[] = [];
  let scripts = 0;
  const walk = (items: unknown[]): TreeNode[] => {
    const nodes: TreeNode[] = [];
    for (const raw of items) {
      if (!isObj(raw)) continue;
      const name = str(raw.name).trim() || "Untitled";
      if (raw.type === "folder" || Array.isArray(raw.items)) {
        const folder: FolderNode = { kind: "folder", id: newId(), name, items: walk(Array.isArray(raw.items) ? raw.items : []) };
        nodes.push(folder);
        continue;
      }
      if (!isObj(raw.request)) continue;
      const r = raw.request;
      const where = `"${name}"`;
      const method = methodOf(r.method, where, warnings);
      if (!method) continue;
      const body = isObj(r.body) ? r.body : {};
      let bodyMode: BodyMode = "none";
      let text = "";
      let form: KeyValue[] = [];
      switch (body.mode) {
        case "json":
          bodyMode = "json";
          text = str(body.json);
          break;
        case "text":
        case "xml":
        case "sparql":
          bodyMode = "text";
          text = str(body[body.mode as string]);
          break;
        case "formUrlEncoded":
          bodyMode = "urlencoded";
          form = brunoRows(body.formUrlEncoded);
          break;
        case "multipartForm":
          bodyMode = "urlencoded";
          form = brunoRows(body.multipartForm, (p) => p.type !== "file");
          warnings.push(`${where}: form-data bodies are sent as url-encoded forms, and file fields were dropped.`);
          break;
        case "graphql": {
          const g = isObj(body.graphql) ? body.graphql : {};
          bodyMode = "json";
          const out: Json = { query: str(g.query) };
          if (str(g.variables).trim() !== "") {
            try {
              out.variables = JSON.parse(str(g.variables));
            } catch {
              out.variables = str(g.variables);
            }
          }
          text = JSON.stringify(out, null, 2);
          break;
        }
      }
      const script = isObj(r.script) ? r.script : {};
      if (str(script.req).trim() !== "" || str(script.res).trim() !== "" || str(r.tests).trim() !== "") scripts += 1;
      const def: RequestDef = {
        id: newId(),
        name,
        method,
        url: str(r.url),
        params: rowsOrEmpty(brunoRows(r.params, (p) => p.type !== "path")),
        headers: rowsOrEmpty(brunoRows(r.headers)),
        bodyMode,
        body: text,
        formBody: rowsOrEmpty(form),
        auth: brunoAuth(r.auth, where, warnings),
      };
      nodes.push(requestNode(def));
    }
    return nodes;
  };
  const name = str(d.name).trim() || "Bruno collection";
  const collection: Collection = { id: newId(), name, items: walk(d.items as unknown[]) };
  if (scripts > 0) warnings.push(`Scripts and tests on ${scripts} request${scripts === 1 ? "" : "s"} were skipped: Bruno's bru API is not the same as REST Runner's rr API.`);
  const environments: Environment[] = [];
  for (const e of Array.isArray(d.environments) ? d.environments : []) {
    if (!isObj(e)) continue;
    const vars = (Array.isArray(e.variables) ? e.variables : []).filter(isObj).filter((v) => str(v.name).trim() !== "");
    if (vars.length === 0) continue;
    const secrets = vars.filter((v) => v.secret === true).length;
    if (secrets > 0) warnings.push(`Environment "${str(e.name)}": ${secrets} secret variable${secrets === 1 ? " is" : "s are"} marked secret; Bruno may have left their values empty.`);
    environments.push(envOf(str(e.name).trim() || "Bruno environment", vars.map((v) => ({ ...kv(str(v.name), str(v.value), v.enabled !== false), ...(v.secret === true ? { secret: true } : {}) }))));
  }
  return { collections: [collection], environments, warnings };
}

// ---- Insomnia export (v4 JSON) -----------------------------------------

export function isInsomniaExport(data: unknown): boolean {
  return isObj(data) && Array.isArray(data.resources) && (data._type === "export" || data.__export_format !== undefined);
}

/** `{{ _.name }}` is Insomnia's variable syntax. Returns the text with REST Runner placeholders and how many other template tags remain. */
function insomniaText(text: string): { text: string; leftover: number } {
  const converted = text.replace(/\{\{\s*_\.([A-Za-z0-9_.-]+)\s*\}\}/g, "{{$1}}");
  const leftover = (converted.match(/\{\{\s*(?!\{)[^}]*\bnow\b[^}]*\}\}|\{%[\s\S]*?%\}|\{\{\s*(?:uuid|timestamp|response|faker|base64|hash)[^}]*\}\}/g) ?? []).length;
  return { text: converted, leftover };
}

function flatten(prefix: string, value: unknown, out: [string, string][]): void {
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) flatten(prefix === "" ? k : `${prefix}.${k}`, v, out);
  } else if (prefix !== "") {
    out.push([prefix, typeof value === "string" ? value : Array.isArray(value) ? JSON.stringify(value) : str(value)]);
  }
}

/** Converts an Insomnia export (format 4 JSON). Each workspace becomes a collection; environments come along as environments. */
export function parseInsomnia(data: unknown): ParsedCollections {
  if (!isInsomniaExport(data)) throw new Error("This is not an Insomnia export. Export as Insomnia v4 (JSON).");
  const resources = ((data as Json).resources as unknown[]).filter(isObj);
  const warnings: string[] = [];
  let leftover = 0;
  const tx = (s: unknown): string => {
    const r = insomniaText(str(s));
    leftover += r.leftover;
    return r.text;
  };
  const byParent = new Map<string, Json[]>();
  for (const r of resources) {
    const p = str(r.parentId);
    byParent.set(p, [...(byParent.get(p) ?? []), r]);
  }
  const sorted = (list: Json[]) => [...list].sort((a, b) => Number(a.metaSortKey ?? 0) - Number(b.metaSortKey ?? 0));

  const convertRequest = (r: Json): RequestDef | null => {
    const name = str(r.name).trim() || "Untitled";
    const where = `"${name}"`;
    const method = methodOf(r.method, where, warnings);
    if (!method) return null;
    const body = isObj(r.body) ? r.body : {};
    const mime = str(body.mimeType).toLowerCase();
    let bodyMode: BodyMode = "none";
    let text = "";
    let form: KeyValue[] = [];
    if (mime.includes("json") || mime === "application/graphql") {
      bodyMode = "json";
      text = tx(body.text);
    } else if (mime === "application/x-www-form-urlencoded") {
      bodyMode = "urlencoded";
      form = (Array.isArray(body.params) ? body.params : []).filter(isObj).map((p) => kv(tx(p.name), tx(p.value), p.disabled !== true));
    } else if (mime.startsWith("multipart/")) {
      bodyMode = "urlencoded";
      form = (Array.isArray(body.params) ? body.params : []).filter(isObj).filter((p) => p.type !== "file").map((p) => kv(tx(p.name), tx(p.value), p.disabled !== true));
      warnings.push(`${where}: form-data bodies are sent as url-encoded forms, and file fields were dropped.`);
    } else if (mime !== "" || str(body.text) !== "") {
      bodyMode = "text";
      text = tx(body.text);
    }
    let auth: AuthConfig = { type: "none" };
    const a = isObj(r.authentication) ? r.authentication : {};
    if (a.disabled !== true && typeof a.type === "string" && a.type !== "none") {
      if (a.type === "bearer") auth = { type: "bearer", token: tx(a.token) };
      else if (a.type === "basic") auth = { type: "basic", username: tx(a.username), password: tx(a.password) };
      else if (a.type === "apikey") auth = { type: "apikey", key: tx(a.key), value: tx(a.value), addTo: a.addTo === "queryParams" ? "query" : "header" };
      else warnings.push(`${where}: "${a.type}" authorization is not supported, so it was imported without auth.`);
    }
    const rows = (x: unknown) => (Array.isArray(x) ? x.filter(isObj).map((p) => kv(tx(p.name), tx(p.value), p.disabled !== true)) : []);
    return {
      id: newId(),
      name,
      method,
      url: tx(r.url),
      params: rowsOrEmpty(rows(r.parameters)),
      headers: rowsOrEmpty(rows(r.headers)),
      bodyMode,
      body: text,
      formBody: rowsOrEmpty(form),
      auth,
    };
  };

  const walk = (parentId: string): TreeNode[] => {
    const nodes: TreeNode[] = [];
    for (const r of sorted(byParent.get(parentId) ?? [])) {
      if (r._type === "request_group") nodes.push({ kind: "folder", id: newId(), name: str(r.name).trim() || "Folder", items: walk(str(r._id)) });
      else if (r._type === "request") {
        const def = convertRequest(r);
        if (def) nodes.push(requestNode(def));
      } else if (r._type === "grpc_request" || r._type === "websocket_request") {
        warnings.push(`"${str(r.name)}": gRPC and WebSocket requests are not supported and were skipped.`);
      }
    }
    return nodes;
  };

  const workspaces = resources.filter((r) => r._type === "workspace" || r._type === "collection");
  const collections: Collection[] = workspaces.map((w) => ({ id: newId(), name: str(w.name).trim() || "Insomnia collection", items: walk(str(w._id)) }));
  const known = new Set(resources.map((r) => str(r._id)));
  const strays = resources.filter((r) => (r._type === "request" || r._type === "request_group") && !known.has(str(r.parentId)));
  if (strays.length > 0) {
    const items: TreeNode[] = [];
    for (const s of strays) {
      byParent.set("__stray", [s]);
      items.push(...walk("__stray"));
    }
    collections.push({ id: newId(), name: "Insomnia requests", items });
  }

  const environments: Environment[] = [];
  for (const e of resources.filter((r) => r._type === "environment")) {
    const pairs: [string, string][] = [];
    flatten("", e.data, pairs);
    if (pairs.length === 0) continue;
    const parent = resources.find((r) => str(r._id) === str(e.parentId));
    const isBase = parent?._type === "workspace" || parent?._type === "collection";
    const name = isBase ? `${str(parent?.name).trim() || "Insomnia"} base environment` : str(e.name).trim() || "Insomnia environment";
    environments.push(envOf(name, pairs.map(([k, v]) => kv(k, tx(v)))));
  }
  if (leftover > 0) warnings.push(`${leftover} Insomnia template tag${leftover === 1 ? "" : "s"} (such as now, uuid or response) cannot be converted and were left as text.`);
  if (collections.length === 0 && environments.length === 0) throw new Error("This Insomnia export has no requests or environments.");
  return { collections, environments, warnings };
}
