import type { PreparedRequest } from "./types";

/** How many redirects are followed before giving up. */
export const MAX_REDIRECTS = 10;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Headers that must not follow a redirect to another origin. */
const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

/**
 * The request to send after a redirect response, or null when the response is
 * not a followable redirect. Follows the same rules as browsers and curl:
 * 303 (and 301/302 after POST) become GET without a body, 307/308 keep both,
 * and credentials are dropped when the origin changes.
 */
export function nextHop(
  req: PreparedRequest,
  status: number,
  responseHeaders: [string, string][],
): PreparedRequest | null {
  if (!REDIRECT_STATUSES.has(status)) return null;
  const location = responseHeaders.find(([name]) => name.toLowerCase() === "location")?.[1];
  if (!location) return null;
  let from: URL;
  let to: URL;
  try {
    from = new URL(req.url);
    to = new URL(location, from);
  } catch {
    return null;
  }
  const toGet =
    status === 303 ? req.method !== "HEAD" : (status === 301 || status === 302) && req.method === "POST";
  const sameOrigin = from.origin === to.origin;
  const headers = req.headers.filter(([name]) => {
    const lower = name.toLowerCase();
    if (!sameOrigin && CREDENTIAL_HEADERS.has(lower)) return false;
    if (toGet && (lower.startsWith("content-") || lower === "transfer-encoding")) return false;
    return true;
  });
  return {
    method: toGet ? "GET" : req.method,
    url: to.toString(),
    headers,
    ...(toGet || req.body === undefined ? {} : { body: req.body }),
  };
}
