import { allValues } from "./secretStore";
import { maskSecrets, redactReport } from "./secrets";
import { setSaveTransform } from "./storage";

/**
 * Redaction of secret environment values from the stores that persist data other than the
 * environments themselves (history, tabs, script variables, saved runs). Only the stored copy
 * is redacted, at the write boundary; whatever the UI holds in memory stays as it was.
 */

export const HISTORY_KEY = "rest-runner.history";
export const TABS_KEY = "rest-runner.tabs";
export const SCRIPT_VARS_KEY = "rest-runner.script-vars";

/** Secret values shorter than this are not redacted: they would mask ordinary text ("on", "1"). */
export const MIN_SECRET_LENGTH = 4;

/** Strings longer than this are cut before masking, so redaction never takes unbounded time. Stored bodies are capped at 1 MB already. */
export const MAX_REDACT_CHARS = 8 * 1024 * 1024;
const TRUNCATED = "\n[cut: too large to redact]";

/** Script variable names whose values are masked whatever they hold. */
export const SECRET_KEY_PATTERN = /token|secret|password|passwd|api[-_]?key|auth(?!or(?!ization))|bearer|cookie|session/i;

/** Structural strings that logic reads back; never user text. */
const STRUCTURAL = new Set(["status", "end", "method", "type", "nodeType", "id"]);

/** The secrets worth redacting: long enough, de-duplicated, longest first. */
export function usableSecrets(secrets: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of secrets) if (typeof s === "string" && s.length >= MIN_SECRET_LENGTH) out.add(s);
  return [...out].sort((a, b) => b.length - a.length);
}

function maskString(text: string, secrets: readonly string[]): string {
  if (text.length < MIN_SECRET_LENGTH) return text;
  const bounded = text.length > MAX_REDACT_CHARS ? text.slice(0, MAX_REDACT_CHARS) + TRUNCATED : text;
  return maskSecrets(bounded, secrets);
}

function walk(value: unknown, secrets: readonly string[], field: string): unknown {
  if (typeof value === "string") return STRUCTURAL.has(field) ? value : maskString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => walk(v, secrets, ""));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    // Keys are copied untouched: they are how the data is found again when loaded.
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, secrets, k);
    return out;
  }
  return value;
}

/**
 * A copy of JSON-like `value` with every known secret value in its strings replaced by the mask.
 * Structure and keys are left as they are, `{{placeholders}}` are untouched (they are not secrets),
 * and the input is never changed. With no usable secrets the input is returned as is.
 */
export function redactForStorage<T>(value: T, secrets: readonly string[] = allValues()): T {
  const usable = usableSecrets(secrets);
  if (usable.length === 0) return value;
  return walk(value, usable, "") as T;
}

/** A saved run (batch, test or flow) with secrets masked, using the same rules as exported reports. */
export function redactRunForStorage<T>(run: T, secrets: readonly string[] = allValues()): T {
  const usable = usableSecrets(secrets);
  if (usable.length === 0) return run;
  return redactReport(run, usable);
}

/**
 * History: everything but the request as typed (`def`, which keeps its `{{placeholders}}`) is
 * redacted: the resolved url, the response, errors and script output.
 */
export function redactHistoryForStorage(value: unknown, secrets: readonly string[] = allValues()): unknown {
  const usable = usableSecrets(secrets);
  if (usable.length === 0 || !Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) out[k] = k === "def" ? v : walk(v, usable, k);
    return out;
  });
}

/**
 * Tabs hold only the requests as typed (placeholders kept, nothing resolved, no responses), so they
 * pass through. If a future version stores a response or resolved echo on a tab, it is redacted here.
 */
export function redactTabsForStorage(value: unknown, secrets: readonly string[] = allValues()): unknown {
  const usable = usableSecrets(secrets);
  if (usable.length === 0 || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const data = value as { tabs?: unknown };
  if (!Array.isArray(data.tabs)) return value;
  const tabs = data.tabs.map((t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) return t;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) out[k] = /^(response|outcome|resolved.*|echo.*)$/.test(k) ? walk(v, usable, k) : v;
    return out;
  });
  return { ...data, tabs };
}

/** True when a script variable name looks like it holds a credential. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** Script variables: values under credential-like names, and any value containing a known secret, are masked. */
export function redactScriptVarsForStorage(value: unknown, secrets: readonly string[] = allValues()): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const usable = usableSecrets(secrets);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      out[k] = v;
      continue;
    }
    // A masked value would be reloaded and sent as a literal (for example as a bearer token), which is worse than
    // having the variable unset. So credential-looking variables, and values containing a known secret, are not
    // persisted at all; the next run of the script sets them again.
    if (v !== "" && isSecretKey(k)) continue;
    if (usable.length && maskString(v, usable) !== v) continue;
    out[k] = v;
  }
  return out;
}

let installed = false;

/** Makes `save()` redact history, tabs and script variables as they are written. Call once at startup. */
export function installStorageRedaction(): void {
  if (installed) return;
  installed = true;
  setSaveTransform(HISTORY_KEY, (v) => redactHistoryForStorage(v));
  setSaveTransform(TABS_KEY, (v) => redactTabsForStorage(v));
  setSaveTransform(SCRIPT_VARS_KEY, (v) => redactScriptVarsForStorage(v));
}

/** For tests. */
export function uninstallStorageRedaction(): void {
  installed = false;
  for (const key of [HISTORY_KEY, TABS_KEY, SCRIPT_VARS_KEY]) setSaveTransform(key, null);
}

// ---- Scrubbing data stored before redaction existed ----

function scrubLocal(key: string, redact: (v: unknown) => unknown): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null) return 0;
    const next = JSON.stringify(redact(parsed));
    if (next === raw) return 0;
    localStorage.setItem(key, next);
    return 1;
  } catch {
    return 0;
  }
}

/**
 * One-time, best-effort cleanup of data stored before redaction existed: rewrites history, tabs,
 * script variables and saved runs (batch, test, flow) with the given secrets masked. Safe to run
 * again (a second run changes nothing), never throws, and leaves anything it cannot parse alone.
 * Returns how many records were changed. Call it after secrets were moved out of environments.
 */
export async function scrubPersistedStores(secrets: readonly string[] = allValues()): Promise<number> {
  const usable = usableSecrets(secrets);
  let changed = 0;
  try {
    // Script variable names are masked by name even with no secrets, so only history and runs wait on `usable`.
    changed += scrubLocal(HISTORY_KEY, (v) => redactHistoryForStorage(v, usable));
    changed += scrubLocal(TABS_KEY, (v) => redactTabsForStorage(v, usable));
    changed += scrubLocal(SCRIPT_VARS_KEY, (v) => redactScriptVarsForStorage(v, usable));
  } catch {
    /* ignore */
  }
  if (usable.length === 0) return changed;
  const redactRun = (record: unknown) => redactReport(record, usable);
  try {
    const { rewriteSavedRuns } = await import("./runStore");
    changed += await rewriteSavedRuns(redactRun);
  } catch {
    /* IndexedDB unavailable */
  }
  try {
    const { rewriteSavedTestAndFlowRuns } = await import("./testing/testRunStore");
    changed += await rewriteSavedTestAndFlowRuns(redactRun);
  } catch {
    /* IndexedDB unavailable */
  }
  return changed;
}

// ---- Literal secrets typed into requests (for a warning, never rewritten) ----

const PLACEHOLDER = /\{\{[^{}]*\}\}/g;
const SCHEME = /^\s*(bearer|basic|token|digest|apikey)\b/i;

/** True when nothing but placeholders (and an auth scheme word such as "Bearer") is in the value. */
export function isPlaceholderOnly(value: string): boolean {
  const rest = value.replace(PLACEHOLDER, "").replace(SCHEME, "");
  return !/[A-Za-z0-9]/.test(rest);
}

const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

/** True for header names that carry credentials: Authorization, Proxy-Authorization, Cookie, X-API-Key, *-Key, *-Token, *-Secret. */
export function isCredentialHeader(name: string): boolean {
  const n = name.trim().toLowerCase();
  return CREDENTIAL_HEADERS.has(n) || /[-_](key|token|secret)$/.test(n);
}

/** True when a header with a credential-like name holds a real value instead of only a `{{placeholder}}`. */
export function looksLikeLiteralSecret(headerName: string, value: string): boolean {
  if (!isCredentialHeader(headerName)) return false;
  return value.trim() !== "" && !isPlaceholderOnly(value);
}

export interface LiteralSecretFinding {
  /** Where, for example `headers[2].value` or `auth.token`. */
  path: string;
  /** What the field is, for the message: a header name, or "Bearer token" / "Basic password" / "API key value". */
  label: string;
}

interface RequestLike {
  headers?: { key: string; value: string; enabled?: boolean }[];
  auth?: { type: string; token?: string; password?: string; value?: string; key?: string };
}

/** Places in a request where a literal credential was typed instead of a `{{placeholder}}`. Disabled headers are skipped. */
export function findLiteralSecrets(request: RequestLike): LiteralSecretFinding[] {
  const out: LiteralSecretFinding[] = [];
  (request.headers ?? []).forEach((h, i) => {
    if (h && h.enabled !== false && typeof h.key === "string" && typeof h.value === "string" && looksLikeLiteralSecret(h.key, h.value))
      out.push({ path: `headers[${i}].value`, label: h.key.trim() });
  });
  const a = request.auth;
  const literal = (v: unknown) => typeof v === "string" && v.trim() !== "" && !isPlaceholderOnly(v);
  if (a?.type === "bearer" && literal(a.token)) out.push({ path: "auth.token", label: "Bearer token" });
  else if (a?.type === "basic" && literal(a.password)) out.push({ path: "auth.password", label: "Basic password" });
  else if (a?.type === "apikey" && literal(a.value)) out.push({ path: "auth.value", label: a.key ? `API key ${a.key}` : "API key value" });
  return out;
}
