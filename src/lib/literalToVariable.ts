import { emptyRow } from "./defaults";
import type { Environment } from "./environments";
import type { AuthConfig } from "./types";

/** The auth fields that can hold a plain-text credential (paths from findLiteralSecrets). */
export type AuthSecretPath = "auth.token" | "auth.password" | "auth.value";

export function isAuthSecretPath(path: string | undefined): path is AuthSecretPath {
  return path === "auth.token" || path === "auth.password" || path === "auth.value";
}

/** The credential in an auth config at `path`, or "" when the type does not match. */
export function authSecretValue(auth: AuthConfig, path: AuthSecretPath): string {
  if (path === "auth.token" && auth.type === "bearer") return auth.token;
  if (path === "auth.password" && auth.type === "basic") return auth.password;
  if (path === "auth.value" && auth.type === "apikey") return auth.value;
  return "";
}

/** A variable name for a credential: `password`, `token`, or the API key's header name (`X-API-Key` becomes `x_api_key`). */
export function suggestVariableName(auth: AuthConfig, path: AuthSecretPath): string {
  if (path === "auth.password") return "password";
  if (path === "auth.token") return "token";
  const fromKey = auth.type === "apikey" ? auth.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") : "";
  return fromKey || "api_key";
}

export type ConversionResult =
  | { ok: true; env: Environment; auth: AuthConfig; name: string; reused: boolean }
  | { ok: false; reason: "no-environment" | "empty" };

/**
 * Moves a plain-text credential out of the request and into a secret variable of `env`,
 * and returns the auth with `{{name}}` in its place. Pure: nothing is saved here.
 *
 * Name collisions: a variable that already holds the same value is reused as it is;
 * a different value gets a numbered name (`password_2`).
 */
export function convertLiteralToVariable(env: Environment | null | undefined, auth: AuthConfig, path: AuthSecretPath): ConversionResult {
  if (!env) return { ok: false, reason: "no-environment" };
  const value = authSecretValue(auth, path);
  if (value === "") return { ok: false, reason: "empty" };

  const base = suggestVariableName(auth, path);
  const taken = (n: string) => env.vars.some((v) => v.key.trim() === n);
  const same = env.vars.find((v) => v.key.trim() === base && v.value === value);
  let name = base;
  let reused = false;
  let vars = env.vars;
  if (same) {
    reused = true;
    // Turn it on and mark it secret, so what the request now points at is enabled and kept in the keychain.
    vars = vars.map((v) => (v === same ? { ...v, enabled: true, secret: true } : v));
  } else {
    for (let n = 2; taken(name); n++) name = `${base}_${n}`;
    const row = { ...emptyRow(), key: name, value, secret: true };
    // Fill the trailing blank row the editor keeps, otherwise append.
    const last = vars[vars.length - 1];
    const blankLast = last && last.key.trim() === "" && last.value === "";
    vars = blankLast ? [...vars.slice(0, -1), row, last] : [...vars, row];
  }

  const ref = `{{${name}}}`;
  const next: AuthConfig =
    path === "auth.token" && auth.type === "bearer"
      ? { ...auth, token: ref }
      : path === "auth.password" && auth.type === "basic"
        ? { ...auth, password: ref }
        : auth.type === "apikey"
          ? { ...auth, value: ref }
          : auth;
  return { ok: true, env: { ...env, vars }, auth: next, name, reused };
}
