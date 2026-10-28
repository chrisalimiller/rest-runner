import { requestNode, type Collection, type FolderNode, type RequestExample, type SampleResponse, type TreeNode } from "./collections";
import { emptyRow } from "./defaults";
import type { Environment } from "./environments";
import { newId } from "./ids";
import { findPostmanCalls } from "./postmanScripts";
import { HTTP_METHODS, type AuthConfig, type BodyMode, type HttpMethod, type KeyValue, type RequestDef } from "./types";

/**
 * Reads Postman exports: collections (v2.0 and v2.1) and environment or globals
 * files. Pure functions, so they are easy to test. Anything that cannot be
 * carried over (file uploads, OAuth and so on) is reported in
 * `warnings` instead of failing the import.
 */

type Json = Record<string, unknown>;

export interface PostmanCollectionImport {
  collection: Collection;
  /** Collection and folder variables, as an environment. Null when there are none. */
  variables: Environment | null;
  warnings: string[];
}

export interface PostmanEnvironmentImport {
  environment: Environment;
  warnings: string[];
}

export type PostmanFileKind = "collection" | "environment" | null;

function isObj(x: unknown): x is Json {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string {
  if (typeof x === "string") return x;
  if (x === null || x === undefined) return "";
  return typeof x === "object" ? JSON.stringify(x) : String(x);
}

/** Tells which kind of Postman export a parsed file is, if any. */
export function detectPostmanFile(data: unknown): PostmanFileKind {
  if (!isObj(data)) return null;
  if (isObj(data.info) && Array.isArray(data.item) && (typeof data.info.schema === "string" ? /getpostman|postman/i.test(data.info.schema) : true)) {
    return "collection";
  }
  if (Array.isArray(data.values) && typeof data.name === "string" && data.app !== "rest-runner") return "environment";
  return null;
}

function row(key: string, value: string, enabled: boolean): KeyValue {
  return { id: newId(), key, value, enabled };
}

/** Postman rows use `disabled: true`; environments use `enabled: false`. */
function rows(x: unknown): KeyValue[] {
  const out: KeyValue[] = [];
  if (Array.isArray(x)) {
    for (const r of x) {
      if (!isObj(r)) continue;
      out.push(row(str(r.key), str(r.value), r.disabled !== true && r.enabled !== false));
    }
  }
  return out.length > 0 ? out : [emptyRow()];
}

/** Postman auth parameters are `[{key, value}]` in v2.1 and `{key: value}` in v2.0. */
function authParams(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(x)) {
    for (const p of x) if (isObj(p) && typeof p.key === "string") out[p.key] = str(p.value);
  } else if (isObj(x)) {
    for (const [k, v] of Object.entries(x)) out[k] = str(v);
  }
  return out;
}

/** Returns undefined when the item has no auth block, so it can inherit. */
function convertAuth(auth: unknown, where: string, warnings: string[]): AuthConfig | undefined {
  if (!isObj(auth) || typeof auth.type !== "string") return undefined;
  const type = auth.type;
  const p = authParams(auth[type]);
  switch (type) {
    case "noauth":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: p.token ?? "" };
    case "basic":
      return { type: "basic", username: p.username ?? "", password: p.password ?? "" };
    case "apikey":
      return { type: "apikey", key: p.key ?? "", value: p.value ?? "", addTo: p.in === "query" ? "query" : "header" };
    default:
      warnings.push(`${where}: "${type}" authorization is not supported, so it was imported without auth.`);
      return { type: "none" };
  }
}

function parseQuery(query: string): KeyValue[] {
  const out: KeyValue[] = [];
  for (const part of query.split("&")) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    const dec = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        return s;
      }
    };
    out.push(row(dec(eq === -1 ? part : part.slice(0, eq)), eq === -1 ? "" : dec(part.slice(eq + 1)), true));
  }
  return out;
}

/** Splits a Postman url (string or object) into a URL without its query, and query rows. */
function convertUrl(url: unknown): { url: string; params: KeyValue[] } {
  let raw = "";
  let query: KeyValue[] | null = null;
  let pathVars: Record<string, string> = {};
  if (typeof url === "string") {
    raw = url;
  } else if (isObj(url)) {
    if (typeof url.raw === "string") {
      raw = url.raw;
    } else {
      const host = Array.isArray(url.host) ? url.host.join(".") : str(url.host);
      const path = Array.isArray(url.path) ? url.path.map(str).join("/") : str(url.path);
      const port = url.port ? `:${str(url.port)}` : "";
      raw = `${url.protocol ? `${str(url.protocol)}://` : ""}${host}${port}${path ? `/${path}` : ""}`;
    }
    if (Array.isArray(url.query)) query = rows(url.query).filter((r) => r.key !== "" || r.value !== "");
    if (Array.isArray(url.variable)) {
      for (const v of url.variable) if (isObj(v) && typeof v.key === "string" && str(v.value) !== "") pathVars[v.key] = str(v.value);
    }
  }
  const hash = raw.indexOf("#");
  const fragment = hash === -1 ? "" : raw.slice(hash);
  const beforeHash = hash === -1 ? raw : raw.slice(0, hash);
  const q = beforeHash.indexOf("?");
  let base = q === -1 ? beforeHash : beforeHash.slice(0, q);
  if (query === null) query = q === -1 ? [] : parseQuery(beforeHash.slice(q + 1));
  // Path variables like /users/:id take the value Postman stored for them.
  base = base.replace(/(\/):([A-Za-z_][\w-]*)/g, (m, slash: string, name: string) => (name in pathVars ? `${slash}${pathVars[name]}` : m));
  return { url: base + fragment, params: query.length > 0 ? query : [emptyRow()] };
}

interface Body {
  bodyMode: BodyMode;
  body: string;
  formBody: KeyValue[];
}

function convertBody(body: unknown, where: string, warnings: string[]): Body {
  const none: Body = { bodyMode: "none", body: "", formBody: [emptyRow()] };
  if (!isObj(body) || body.disabled === true) return none;
  switch (body.mode) {
    case "raw": {
      const options = isObj(body.options) && isObj(body.options.raw) ? body.options.raw : {};
      return { ...none, bodyMode: options.language === "json" ? "json" : "text", body: str(body.raw) };
    }
    case "urlencoded":
      return { ...none, bodyMode: "urlencoded", formBody: rows(body.urlencoded) };
    case "formdata": {
      const parts = Array.isArray(body.formdata) ? body.formdata.filter(isObj) : [];
      const files = parts.filter((p) => p.type === "file").length;
      const text = parts.filter((p) => p.type !== "file");
      warnings.push(
        `${where}: form-data bodies are sent as url-encoded forms${files > 0 ? `, and ${files} file field${files === 1 ? " was" : "s were"} dropped` : ""}.`,
      );
      return { ...none, bodyMode: "urlencoded", formBody: rows(text) };
    }
    case "graphql": {
      const g = isObj(body.graphql) ? body.graphql : {};
      const out: Json = { query: str(g.query) };
      const vars = str(g.variables).trim();
      if (vars !== "") {
        try {
          out.variables = JSON.parse(vars);
        } catch {
          out.variables = vars;
        }
      }
      return { ...none, bodyMode: "json", body: JSON.stringify(out, null, 2) };
    }
    case "file":
      warnings.push(`${where}: a file body is not supported and was dropped.`);
      return none;
    default:
      return none;
  }
}

function convertRequest(
  name: string,
  req: unknown,
  inheritedAuth: AuthConfig,
  warnings: string[],
): RequestDef | null {
  const where = `"${name}"`;
  const r: Json = typeof req === "string" ? { url: req, method: "GET" } : isObj(req) ? req : {};
  const method = (typeof r.method === "string" ? r.method : "GET").toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) {
    warnings.push(`${where}: the ${method} method is not supported, so the request was skipped.`);
    return null;
  }
  const { url, params } = convertUrl(r.url);
  const headers = Array.isArray(r.header) ? rows(r.header) : [emptyRow()];
  const body = convertBody(r.body, where, warnings);
  const auth = convertAuth(r.auth, where, warnings) ?? inheritedAuth;
  return {
    id: newId(),
    name,
    method: method as HttpMethod,
    url,
    params,
    headers,
    ...body,
    auth,
  };
}

function convertExamples(item: Json, request: RequestDef, auth: AuthConfig, warnings: string[]): RequestExample[] {
  if (!Array.isArray(item.response)) return [];
  const out: RequestExample[] = [];
  for (const [i, ex] of item.response.entries()) {
    if (!isObj(ex)) continue;
    const name = typeof ex.name === "string" && ex.name !== "" ? ex.name : `Example ${i + 1}`;
    const id = newId();
    const converted = ex.originalRequest ? convertRequest(request.name, ex.originalRequest, auth, []) : null;
    const base = converted ?? request;
    const headers: [string, string][] = Array.isArray(ex.header)
      ? ex.header.filter(isObj).map((h) => [str(h.key), str(h.value)] as [string, string])
      : [];
    const code = typeof ex.code === "number" ? ex.code : Number(ex.code);
    const response: SampleResponse | undefined = Number.isFinite(code)
      ? { status: code, statusText: str(ex.status), headers, body: str(ex.body) }
      : undefined;
    out.push({ id, name, request: { ...base, id, name }, response });
  }
  void warnings;
  return out;
}

/** The script of one kind ("prerequest" or "test") on a collection, folder or request. Empty when there is none. */
function eventScript(item: Json, listen: "prerequest" | "test"): string {
  if (!Array.isArray(item.event)) return "";
  const parts: string[] = [];
  for (const e of item.event) {
    if (!isObj(e) || e.listen !== listen || e.disabled === true || !isObj(e.script)) continue;
    const exec = Array.isArray(e.script.exec) ? e.script.exec.map(str).join("\n") : str(e.script.exec);
    if (exec.trim() !== "") parts.push(exec);
  }
  return parts.join("\n");
}

/** Scripts a request inherits from its collection and folders, outermost first. */
interface InheritedScripts {
  label: string;
  pre: string;
  post: string;
}

/**
 * Postman runs collection, folder and request scripts in turn. Here scripts belong to a request, so
 * the inherited ones are copied in front of the request's own, each in its own block with a comment
 * saying where it came from. A request with only its own script keeps it unchanged.
 */
function chainScripts(inherited: string[], own: string): string {
  if (inherited.length === 0) return own;
  const blocks = [...inherited];
  if (own !== "") blocks.push(`// This request's own script\n{\n${own}\n}`);
  return blocks.join("\n");
}

function inheritedBlock(label: string, script: string): string {
  return script === "" ? "" : `// From Postman: ${label}\n{\n${script}\n}`;
}

function variablesEnv(id: string, name: string, vars: KeyValue[]): Environment | null {
  const filled = vars.filter((v) => v.key.trim() !== "");
  return filled.length === 0 ? null : { id, name, vars: filled };
}

/** Converts a parsed Postman collection (v2.0 or v2.1). */
export function importPostmanCollection(data: unknown): PostmanCollectionImport {
  if (!isObj(data) || !isObj(data.info) || !Array.isArray(data.item)) {
    throw new Error("This is not a Postman collection (v2.0 or v2.1).");
  }
  const warnings: string[] = [];
  const name = typeof data.info.name === "string" && data.info.name.trim() !== "" ? data.info.name : "Postman collection";
  const postmanId = typeof data.info._postman_id === "string" && data.info._postman_id !== "" ? data.info._postman_id : null;
  const collectionId = postmanId ? `postman-${postmanId}` : newId();
  const variables: KeyValue[] = Array.isArray(data.variable) ? rows(data.variable) : [];
  const stats = { requests: 0, copies: 0, stillPm: 0, fixable: 0, manual: 0 };

  const walk = (items: unknown[], inherited: AuthConfig, scripts: InheritedScripts[]): TreeNode[] => {
    const nodes: TreeNode[] = [];
    for (const raw of items) {
      if (!isObj(raw)) continue;
      const itemName = typeof raw.name === "string" && raw.name !== "" ? raw.name : "Untitled";
      const auth = convertAuth(raw.auth, `"${itemName}"`, warnings);
      if (Array.isArray(raw.item)) {
        if (Array.isArray(raw.variable)) variables.push(...rows(raw.variable).filter((v) => v.key !== ""));
        const folder: FolderNode = { kind: "folder", id: newId(), name: itemName, items: walk(raw.item, auth ?? inherited, [...scripts, { label: `folder "${itemName}"`, pre: eventScript(raw, "prerequest"), post: eventScript(raw, "test") }]) };
        nodes.push(folder);
      } else if (raw.request !== undefined) {
        const effective = auth ?? inherited;
        const def = convertRequest(itemName, raw.request, effective, warnings);
        if (def) {
          const examples = convertExamples(raw, def, effective, warnings);
          const pre = chainScripts(scripts.map((x) => inheritedBlock(x.label, x.pre)).filter((b) => b !== ""), eventScript(raw, "prerequest"));
          const post = chainScripts(scripts.map((x) => inheritedBlock(x.label, x.post)).filter((b) => b !== ""), eventScript(raw, "test"));
          const copied = pre !== eventScript(raw, "prerequest") || post !== eventScript(raw, "test");
          if (pre !== "") def.preScript = pre;
          if (post !== "") def.postScript = post;
          if (pre !== "" || post !== "") {
            stats.requests += 1;
            if (copied) stats.copies += 1;
            const calls = [...findPostmanCalls(pre), ...findPostmanCalls(post)];
            if (calls.length > 0) stats.stillPm += 1;
            for (const c of calls) c.fix ? (stats.fixable += 1) : (stats.manual += 1);
          }
          nodes.push(requestNode(def, examples));
        }
      }
    }
    return nodes;
  };

  const rootAuth = convertAuth(data.auth, "The collection", warnings) ?? { type: "none" };
  const items = walk(data.item, rootAuth, [{ label: `collection "${name}"`, pre: eventScript(data, "prerequest"), post: eventScript(data, "test") }]);
  if (stats.requests > 0) {
    const s = stats.requests === 1 ? "" : "s";
    warnings.push(
      stats.stillPm > 0
        ? `Imported scripts on ${stats.requests} request${s}. ${stats.stillPm} still use${stats.stillPm === 1 ? "s" : ""} Postman pm.* calls (${stats.fixable} can be converted with one click, ${stats.manual} need changes by hand). Open a request's Scripts tab to convert them. Requests with pm.* scripts will not run until they are converted.`
        : `Imported scripts on ${stats.requests} request${s}.`,
    );
    if (stats.copies > 0) {
      warnings.push(`Collection and folder scripts were copied into each request inside them (${stats.copies} request${stats.copies === 1 ? "" : "s"}), because REST Runner runs scripts per request.`);
    }
  }
  return {
    collection: { id: collectionId, name, items },
    variables: variablesEnv(`${collectionId}-variables`, `${name} variables`, variables),
    warnings,
  };
}

/** Converts a parsed Postman environment or globals file. */
export function importPostmanEnvironment(data: unknown): PostmanEnvironmentImport {
  if (!isObj(data) || !Array.isArray(data.values)) throw new Error("This is not a Postman environment file.");
  const warnings: string[] = [];
  const name = typeof data.name === "string" && data.name.trim() !== "" ? data.name : "Postman environment";
  const id = typeof data.id === "string" && data.id !== "" ? `postman-${data.id}` : newId();
  const vars = rows(data.values).filter((v) => v.key.trim() !== "");
  const secrets = data.values.filter((v) => isObj(v) && v.type === "secret").length;
  if (secrets > 0) warnings.push(`${secrets} secret variable${secrets === 1 ? "" : "s"} imported as plain values; Postman may have exported them empty.`);
  return { environment: { id, name, vars: vars.length > 0 ? vars : [emptyRow()] }, warnings };
}
