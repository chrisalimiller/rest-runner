import { newId } from "./ids";
import { HTTP_METHODS, type AuthConfig, type BodyMode, type HttpMethod, type KeyValue, type RequestDef } from "./types";

export function emptyRow(): KeyValue {
  return { id: newId(), key: "", value: "", enabled: true };
}

export function newRequest(): RequestDef {
  return {
    id: newId(),
    name: "Untitled request",
    method: "GET",
    url: "",
    params: [emptyRow()],
    headers: [emptyRow()],
    bodyMode: "none",
    body: "",
    formBody: [emptyRow()],
    auth: { type: "none" },
  };
}

const BODY_MODES: readonly BodyMode[] = ["none", "json", "text", "urlencoded"];

function cleanRows(x: unknown): KeyValue[] {
  if (!Array.isArray(x)) return [emptyRow()];
  const rows = x
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      ...(r as unknown as KeyValue),
      id: typeof r.id === "string" ? r.id : newId(),
      key: typeof r.key === "string" ? r.key : "",
      value: typeof r.value === "string" ? r.value : "",
      enabled: r.enabled !== false,
    }));
  return rows.length > 0 ? rows : [emptyRow()];
}

function cleanAuth(x: unknown): AuthConfig {
  const a = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (a.type) {
    case "bearer":
      return { type: "bearer", token: str(a.token) };
    case "basic":
      return { type: "basic", username: str(a.username), password: str(a.password) };
    case "apikey":
      return { type: "apikey", key: str(a.key), value: str(a.value), addTo: a.addTo === "query" ? "query" : "header" };
    default:
      return { type: "none" };
  }
}

/**
 * A stored request (the draft, a history entry) made safe to open: missing or broken parts get
 * their defaults. Null when it is not a request at all.
 */
export function completeRequest(x: unknown): RequestDef | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.url !== "string") return null;
  const base = newRequest();
  return {
    ...(r as unknown as RequestDef),
    id: typeof r.id === "string" ? r.id : base.id,
    name: typeof r.name === "string" ? r.name : base.name,
    method: (HTTP_METHODS as readonly unknown[]).includes(r.method) ? (r.method as HttpMethod) : "GET",
    url: r.url,
    params: cleanRows(r.params),
    headers: cleanRows(r.headers),
    bodyMode: BODY_MODES.includes(r.bodyMode as BodyMode) ? (r.bodyMode as BodyMode) : "none",
    body: typeof r.body === "string" ? r.body : "",
    formBody: cleanRows(r.formBody),
    auth: cleanAuth(r.auth),
    preScript: typeof r.preScript === "string" ? r.preScript : undefined,
    postScript: typeof r.postScript === "string" ? r.postScript : undefined,
  };
}
