import type { KeyValue, RequestDef } from "./types";

/** One value that was swapped for a {{variable}}. */
export interface VarSwap {
  /** The variable's name, without braces. */
  name: string;
  /** Where in the request it was found, e.g. "URL" or "Header: X-Api-Key". */
  where: string;
  /** The variable is marked secret, so its value must be masked when shown. */
  secret: boolean;
  /** The literal value that was replaced. */
  value: string;
}

/** Values shorter than this are never swapped: `1` or `true` would match far too much. */
export const MIN_SWAP_LENGTH = 4;

interface Candidate {
  name: string;
  value: string;
  secret: boolean;
}

function candidates(vars: readonly KeyValue[]): Candidate[] {
  return vars
    .filter((v) => v.enabled && v.key.trim() !== "" && v.value.length >= MIN_SWAP_LENGTH && !v.value.includes("{{"))
    .map((v) => ({ name: v.key.trim(), value: v.value, secret: v.secret === true }))
    .sort((a, b) => b.value.length - a.value.length);
}

/** `https://sit.test/api` matches `https://sit.test/api/orders` but not `https://sit.test/api2`. */
function urlPrefixMatch(url: string, value: string): string | null {
  if (url.startsWith(value)) {
    const rest = url.slice(value.length);
    if (value.endsWith("/") || rest === "" || /^[/?:]/.test(rest)) return rest;
    return null;
  }
  // A trailing slash on the variable that the URL doesn't have.
  if (value.endsWith("/") && url === value.slice(0, -1)) return "";
  return null;
}

/**
 * Replaces literal values in a parsed request with `{{name}}` for variables of the active
 * environment. Bodies are left alone. Pure, so it can be switched on and off without re-parsing.
 */
export function matchVariables(def: RequestDef, vars: readonly KeyValue[]): { def: RequestDef; swaps: VarSwap[] } {
  const list = candidates(vars);
  const swaps: VarSwap[] = [];
  if (list.length === 0) return { def, swaps };

  const whole = (value: string, where: string): string => {
    if (value === "") return value;
    const hit = list.find((c) => c.value === value);
    if (!hit) return value;
    swaps.push({ name: hit.name, where, secret: hit.secret, value });
    return `{{${hit.name}}}`;
  };
  const rows = (rs: KeyValue[], label: string, keyed: boolean): KeyValue[] =>
    rs.map((r) => {
      if (r.key.trim() === "") return r;
      const where = `${label}: ${r.key}`;
      let value = r.value;
      const bearer = keyed ? /^(Bearer\s+)(.+)$/i.exec(value) : null;
      if (bearer) value = bearer[1] + whole(bearer[2], where);
      else value = whole(value, where);
      return value === r.value ? r : { ...r, value };
    });

  let url = def.url;
  for (const c of list) {
    const rest = urlPrefixMatch(url, c.value);
    if (rest !== null) {
      swaps.push({ name: c.name, where: "URL", secret: c.secret, value: c.value });
      url = `{{${c.name}}}${rest}`;
      break;
    }
  }

  let auth = def.auth;
  if (auth.type === "bearer") auth = { ...auth, token: whole(auth.token, "Bearer token") };
  else if (auth.type === "basic") auth = { ...auth, username: whole(auth.username, "Basic user name"), password: whole(auth.password, "Basic password") };

  const params = rows(def.params, "Param", false);
  const headers = rows(def.headers, "Header", true);
  const formBody = rows(def.formBody, "Form field", false);
  if (swaps.length === 0) return { def, swaps };
  return { def: { ...def, url, params, headers, formBody, auth }, swaps };
}
