import { applyJsonTemplate, applyTemplate, findPlaceholders, type Vars } from "./template";
import type { KeyValue, PreparedRequest, RequestDef } from "./types";

function activeRows(rows: KeyValue[], vars: Vars): [string, string][] {
  return rows
    .filter((r) => r.enabled && r.key.trim() !== "")
    .map((r) => [applyTemplate(r.key.trim(), vars), applyTemplate(r.value, vars)]);
}

function encodePairs(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Adds http:// when the URL has no scheme, like Postman does. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") return trimmed;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function appendQuery(url: string, pairs: [string, string][]): string {
  if (pairs.length === 0) return url;
  const hashIndex = url.indexOf("#");
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const sep = base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?";
  return `${base}${sep}${encodePairs(pairs)}${hash}`;
}

function hasHeader(headers: [string, string][], name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some(([k]) => k.toLowerCase() === lower);
}

/** Fills in placeholders, applies auth and body settings, and returns what will be sent. */
export function prepareRequest(def: RequestDef, vars: Vars = {}): PreparedRequest {
  const query = activeRows(def.params, vars);
  const headers = activeRows(def.headers, vars);
  const auth = def.auth;

  switch (auth.type) {
    case "bearer":
      if (!hasHeader(headers, "Authorization")) {
        headers.push(["Authorization", `Bearer ${applyTemplate(auth.token, vars)}`]);
      }
      break;
    case "basic":
      if (!hasHeader(headers, "Authorization")) {
        const creds = `${applyTemplate(auth.username, vars)}:${applyTemplate(auth.password, vars)}`;
        headers.push(["Authorization", `Basic ${toBase64(creds)}`]);
      }
      break;
    case "apikey": {
      const key = applyTemplate(auth.key, vars).trim();
      if (key !== "") {
        const value = applyTemplate(auth.value, vars);
        if (auth.addTo === "header") {
          if (!hasHeader(headers, key)) headers.push([key, value]);
        } else {
          query.push([key, value]);
        }
      }
      break;
    }
    case "none":
      break;
  }

  let body: string | undefined;
  const allowsBody = def.method !== "GET" && def.method !== "HEAD";
  if (allowsBody) {
    if (def.bodyMode === "json" || def.bodyMode === "text") {
      body = def.bodyMode === "json" ? applyJsonTemplate(def.body, vars) : applyTemplate(def.body, vars);
      if (!hasHeader(headers, "Content-Type")) {
        headers.push(["Content-Type", def.bodyMode === "json" ? "application/json" : "text/plain"]);
      }
    } else if (def.bodyMode === "urlencoded") {
      body = encodePairs(activeRows(def.formBody, vars));
      if (!hasHeader(headers, "Content-Type")) {
        headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
      }
    }
  }

  const url = appendQuery(normalizeUrl(applyTemplate(def.url, vars)), query);
  return { method: def.method, url, headers, body };
}

/** Lists the {{placeholders}} a request uses in the parts that will actually be sent. */
export function requestPlaceholders(def: RequestDef): string[] {
  const parts: string[] = [def.url];
  const addRows = (rows: KeyValue[]) => {
    for (const r of rows) if (r.enabled && r.key.trim() !== "") parts.push(r.key, r.value);
  };
  addRows(def.params);
  addRows(def.headers);
  const allowsBody = def.method !== "GET" && def.method !== "HEAD";
  if (allowsBody && (def.bodyMode === "json" || def.bodyMode === "text")) parts.push(def.body);
  if (allowsBody && def.bodyMode === "urlencoded") addRows(def.formBody);
  const a = def.auth;
  if (a.type === "bearer") parts.push(a.token);
  if (a.type === "basic") parts.push(a.username, a.password);
  if (a.type === "apikey") parts.push(a.key, a.value);
  return [...new Set(parts.flatMap(findPlaceholders))];
}

/** The placeholders `requestPlaceholders` finds that have no value in `vars` (use the same vars Send uses). */
export function unresolvedPlaceholders(def: RequestDef, vars: Vars): string[] {
  return requestPlaceholders(def).filter((name) => !Object.prototype.hasOwnProperty.call(vars, name));
}
