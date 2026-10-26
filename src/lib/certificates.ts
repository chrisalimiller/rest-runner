import { load, save } from "./storage";

export const CERTIFICATES_KEY = "rest-runner.certificates";

/** Facts read from a certificate file when it is imported. Dates are Unix seconds. */
export interface CertDetails {
  subject: string;
  issuer: string;
  notBefore: number;
  notAfter: number;
  /** Fingerprint of the certificate, lowercase hex. */
  sha256: string;
}

export interface CaDetailsInfo {
  count: number;
  details: CertDetails;
}

/**
 * An imported certificate. The files and the passphrase are kept by the desktop app
 * (see src-tauri/src/certs.rs) under the same `id`; this is only what the UI needs.
 */
export interface CertificateEntry {
  id: string;
  name: string;
  enabled: boolean;
  /** `host[:port][/path-prefix]`, `*.` allowed at the start of the host. See parsePattern. */
  patterns: string[];
  client?: {
    format: "pem" | "pkcs12";
    separateKey: boolean;
    hasPassphrase: boolean;
    /** The PEM key sits in a file without a passphrase. */
    keyUnencrypted: boolean;
    details: CertDetails;
  };
  /** Extra trusted roots for the matching hosts. */
  ca?: CaDetailsInfo;
  /** Trust only this entry's CA for the matching hosts, not the system roots. */
  caOnly?: boolean;
  /** Came from a workspace file without its files. Disabled until the same certificate is imported. */
  needsFile?: boolean;
}

/** What Rust gets for a call (`TlsSpec` in src-tauri/src/http.rs). */
export interface TlsSpec {
  certId?: string;
  caIds: string[];
  caOnly: boolean;
}

/** The certificate a call used, kept with its result. */
export interface CertificateUse {
  id: string;
  name: string;
  sha256: string;
}

export interface ParsedPattern {
  /** Lowercase, punycode. Without the `*.` of a wildcard. */
  host: string;
  wildcard: boolean;
  port: number | null;
  /** No leading or trailing slash. Empty means any path. */
  path: string;
}

/** Splits `host[:port][/path]`. A leading `https://` is accepted and ignored. Returns an error message when it cannot. */
export function parsePattern(input: string): ParsedPattern | string {
  let text = input.trim();
  if (text === "") return "Empty pattern";
  text = text.replace(/^https:\/\//i, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return "Only https addresses use certificates";
  const slash = text.indexOf("/");
  const hostPort = slash === -1 ? text : text.slice(0, slash);
  const path = (slash === -1 ? "" : text.slice(slash)).replace(/^\/+|\/+$/g, "");
  if (/[?#\s]/.test(text)) return "Leave out spaces, ? and #";
  const portMatch = /^(.*):(\d{1,5})$/.exec(hostPort);
  const port = portMatch ? Number(portMatch[2]) : null;
  let host = portMatch ? portMatch[1] : hostPort;
  if (port !== null && (port < 1 || port > 65535)) return "Port must be 1 to 65535";
  const wildcard = host.startsWith("*.");
  if (wildcard) host = host.slice(2);
  if (host === "" || host.includes("*")) return "Wildcards are only allowed as a leading *.";
  let normalized: string;
  try {
    normalized = new URL(`https://${host}`).hostname;
  } catch {
    return `"${host}" is not a valid host`;
  }
  if (wildcard && (/^\d+(\.\d+){3}$/.test(normalized) || normalized.startsWith("["))) return "A wildcard cannot be used with an IP address";
  return { host: normalized, wildcard, port, path };
}

/** The error to show for a pattern the user typed, or null when it is fine. */
export function patternError(input: string): string | null {
  const parsed = parsePattern(input);
  return typeof parsed === "string" ? parsed : null;
}

/** Order that makes one pattern more specific than another. Compared field by field. */
type Specificity = [exactHost: number, suffixLabels: number, port: number, pathLength: number];

function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

interface Hit {
  entry: CertificateEntry;
  pattern: string;
  specificity: Specificity;
}

function matchPattern(pattern: ParsedPattern, url: URL): Specificity | null {
  const host = url.hostname;
  const exact = !pattern.wildcard && host === pattern.host;
  const wild = pattern.wildcard && host.endsWith(`.${pattern.host}`) && host.length > pattern.host.length + 1;
  if (!exact && !wild) return null;
  const urlPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (pattern.port !== null && pattern.port !== urlPort) return null;
  const urlPath = url.pathname.replace(/^\/+|\/+$/g, "");
  if (pattern.path !== "" && urlPath !== pattern.path && !urlPath.startsWith(`${pattern.path}/`)) return null;
  return [exact ? 1 : 0, wild ? pattern.host.split(".").length : 0, pattern.port === null ? 0 : 1, pattern.path.length];
}

export interface CertificateMatch {
  /** The entry whose client certificate is presented. */
  client: CertificateEntry | null;
  /** The pattern of `client` that matched. */
  clientPattern: string | null;
  /** Every matching entry with a CA; their CAs are all trusted. */
  cas: CertificateEntry[];
  /** Other entries with a client certificate that matched equally well and lost on list order. */
  ties: CertificateEntry[];
  /** The URL is http: and would have matched, so a hint is shown instead. */
  insecure: boolean;
}

const NO_MATCH: CertificateMatch = { client: null, clientPattern: null, cas: [], ties: [], insecure: false };

/**
 * Finds the certificates for a URL that is already filled in. Most specific wins, in this order:
 * exact host over wildcard, longer wildcard suffix, a port given, longer path prefix, then list order.
 * Only https URLs get a certificate. A URL that still has {{placeholders}} gets none.
 */
export function matchCertificate(urlText: string, entries: readonly CertificateEntry[]): CertificateMatch {
  if (urlText.includes("{{")) return NO_MATCH;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return NO_MATCH;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return NO_MATCH;
  const secure = url.protocol === "https:";
  const hits: Hit[] = [];
  for (const entry of entries) {
    if (!entry.enabled || entry.needsFile) continue;
    let best: Hit | null = null;
    for (const text of entry.patterns) {
      const parsed = parsePattern(text);
      if (typeof parsed === "string") continue;
      const specificity = matchPattern(parsed, url);
      if (specificity && (!best || compareSpecificity(specificity, best.specificity) > 0)) best = { entry, pattern: text, specificity };
    }
    if (best) hits.push(best);
  }
  if (hits.length === 0) return NO_MATCH;
  if (!secure) return { ...NO_MATCH, insecure: hits.some((h) => h.entry.client || h.entry.ca) };

  const withClient = hits.filter((h) => h.entry.client);
  let winner: Hit | null = null;
  for (const hit of withClient) if (!winner || compareSpecificity(hit.specificity, winner.specificity) > 0) winner = hit;
  const ties = winner ? withClient.filter((h) => h !== winner && compareSpecificity(h.specificity, winner.specificity) === 0).map((h) => h.entry) : [];
  return {
    client: winner?.entry ?? null,
    clientPattern: winner?.pattern ?? null,
    cas: hits.filter((h) => h.entry.ca).map((h) => h.entry),
    ties,
    insecure: false,
  };
}

/** What to tell Rust for a call, and which certificate to record. Null when no certificate applies. */
export function tlsFor(
  urlText: string,
  entries: readonly CertificateEntry[],
  skipClient = false,
): { tls: TlsSpec; used?: CertificateUse } | null {
  const match = matchCertificate(urlText, entries);
  const client = skipClient ? null : match.client;
  if (!client && match.cas.length === 0) return null;
  return {
    tls: {
      certId: client?.id,
      caIds: match.cas.map((e) => e.id),
      caOnly: match.cas.some((e) => e.caOnly),
    },
    used: client?.client ? { id: client.id, name: client.name, sha256: client.client.details.sha256 } : undefined,
  };
}

/**
 * For each entry with a client certificate, the names of other enabled entries that have the same
 * pattern (same host, wildcard, port and path), so the UI can warn that only the first one is used.
 */
export function findDuplicatePatterns(entries: readonly CertificateEntry[]): Record<string, string[]> {
  const canonical = (text: string) => {
    const p = parsePattern(text);
    return typeof p === "string" ? null : `${p.wildcard ? "*." : ""}${p.host}|${p.port ?? ""}|${p.path}`;
  };
  const owners = new Map<string, CertificateEntry[]>();
  for (const e of entries) {
    if (!e.enabled || e.needsFile || !e.client) continue;
    for (const key of new Set(e.patterns.map(canonical))) {
      if (key) owners.set(key, [...(owners.get(key) ?? []), e]);
    }
  }
  const out: Record<string, string[]> = {};
  for (const group of owners.values()) {
    if (group.length < 2) continue;
    for (const e of group) {
      out[e.id] = [...new Set([...(out[e.id] ?? []), ...group.filter((o) => o !== e).map((o) => o.name || "(unnamed)")])];
    }
  }
  return out;
}

/** What a command or script outside the app needs to send the same call: the entry's client certificate and CA. */
export interface CertificateExport {
  client: CertificateEntry | null;
  /** Placeholder file names for the user to point at their own copies, e.g. `acme-staging`. */
  stem: string;
  /** The CA of the first matching entry with one. */
  ca: CertificateEntry | null;
}

/** The certificates a URL would use, for Copy as cURL and script exports. Null when none apply. */
export function certificateForExport(urlText: string, entries: readonly CertificateEntry[], skipClient = false): CertificateExport | null {
  const match = matchCertificate(urlText, entries);
  const client = skipClient ? null : match.client;
  const ca = match.cas[0] ?? null;
  if (!client && !ca) return null;
  const name = (client ?? ca)!.name;
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "certificate";
  return { client, stem, ca };
}

/** `Acme staging (ab12cd34)` for reports. Empty when no certificate was used. */
export function certificateLabel(use: CertificateUse | undefined): string {
  return use ? `${use.name || "(unnamed)"} (${shortFingerprint(use.sha256)})` : "";
}

export type ExpiryState = "ok" | "soon" | "expired";

export const EXPIRY_WARNING_DAYS = 30;

export function expiryState(notAfter: number, now = Date.now()): ExpiryState {
  const ms = notAfter * 1000 - now;
  if (ms < 0) return "expired";
  return ms < EXPIRY_WARNING_DAYS * 86_400_000 ? "soon" : "ok";
}

/** Short form of a fingerprint for tables: first 8 hex digits. */
export function shortFingerprint(sha256: string): string {
  return sha256.slice(0, 8);
}

/** `AB:CD:...` as other tools print it. */
export function formatFingerprint(sha256: string): string {
  return (sha256.toUpperCase().match(/.{1,2}/g) ?? []).join(":");
}

/**
 * Turns a failed send's low-level error into plain words when a certificate is the likely cause.
 * Returns the original message when it has nothing better to say.
 */
export function explainTlsError(message: string, ctx: { host: string; usedCertificate?: string }): string {
  const m = message.toLowerCase();
  if (/unknownissuer|unknown issuer|self.signed|not trusted/.test(m)) {
    return `${message}\nThe server's certificate is not trusted. If it comes from a private CA, add the CA file under Certificates for ${ctx.host}.`;
  }
  if (/certificaterequired|certificate required|no certificates|peer sent no certificates|bad certificate|handshake failure/.test(m)) {
    return ctx.usedCertificate
      ? `${message}\nThe server did not accept the certificate "${ctx.usedCertificate}".`
      : `${message}\nThe server asked for a client certificate and none matched ${ctx.host}. Add one under Certificates.`;
  }
  if (/expired/.test(m)) return `${message}\nA certificate in this connection has expired.`;
  return message;
}

// A small shared store, so the manager, the URL bar chip and sendRequest all see the same list.

let current: CertificateEntry[] | null = null;
const listeners = new Set<() => void>();

export function loadCertificates(): CertificateEntry[] {
  if (current === null) current = load<CertificateEntry[]>(CERTIFICATES_KEY, []);
  return current;
}

/** Returns false when the browser refused to store the list. */
export function saveCertificates(entries: CertificateEntry[]): boolean {
  current = entries;
  const ok = save(CERTIFICATES_KEY, entries);
  listeners.forEach((l) => l());
  return ok;
}

export function subscribeCertificates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests. */
export function resetCertificateCache(): void {
  current = null;
}
