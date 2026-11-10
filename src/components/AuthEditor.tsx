import { useId } from "react";
import { LiteralSecretBadge } from "./shell/LiteralSecretBadge";
import type { Vars } from "../lib/template";
import type { AuthConfig } from "../lib/types";
import { PlaceholderInput } from "./PlaceholderInput";
import { PasswordInput } from "./PasswordInput";

interface Props {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
  /** Values the placeholders can be filled from. With it, {{placeholders}} are drawn and open the variable card on hover. */
  placeholderVars?: Vars;
  /** Path from findLiteralSecrets (`auth.token`, `auth.password`, `auth.value`) when that field holds a plain-text credential. */
  literalPath?: string;
}

const LABELS: Record<AuthConfig["type"], string> = {
  none: "No auth",
  bearer: "Bearer token",
  basic: "Basic auth",
  apikey: "API key",
};

function defaultsFor(type: AuthConfig["type"]): AuthConfig {
  switch (type) {
    case "bearer":
      return { type, token: "" };
    case "basic":
      return { type, username: "", password: "" };
    case "apikey":
      return { type, key: "", value: "", addTo: "header" };
    default:
      return { type: "none" };
  }
}

export function AuthEditor({ auth, onChange, placeholderVars, literalPath }: Props) {
  const hintId = useId();
  /** The warn-only badge, beside the label of the field that holds a plain-text credential. */
  const badge = (path: string) => (literalPath === path ? <LiteralSecretBadge id={hintId} /> : null);
  const described = (path: string) => (literalPath === path ? { "aria-describedby": hintId } : {});
  /** A text field that draws placeholders when it can. */
  const text = (value: string, onValue: (v: string) => void, extra: { placeholder?: string; "aria-describedby"?: string } = {}) =>
    placeholderVars ? (
      <PlaceholderInput value={value} vars={placeholderVars} onChange={onValue} spellCheck={false} {...extra} />
    ) : (
      <input value={value} onChange={(e) => onValue(e.target.value)} spellCheck={false} {...extra} />
    );

  return (
    <div className="auth">
      <label className="field">
        <span>Type</span>
        <select value={auth.type} onChange={(e) => onChange(defaultsFor(e.target.value as AuthConfig["type"]))}>
          {Object.entries(LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {auth.type === "none" && <p className="muted">This request does not use any authorization.</p>}

      {auth.type === "bearer" && (
        <label className="field">
          <span>Token {badge("auth.token")}</span>
          {text(auth.token, (token) => onChange({ ...auth, token }), { placeholder: "Token or {{variable}}", ...described("auth.token") })}
        </label>
      )}

      {auth.type === "basic" && (
        <>
          <label className="field">
            <span>Username</span>
            {text(auth.username, (username) => onChange({ ...auth, username }))}
          </label>
          <label className="field">
            <span>Password {badge("auth.password")}</span>
            <PasswordInput
              {...described("auth.password")}
              value={auth.password}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </label>
        </>
      )}

      {auth.type === "apikey" && (
        <>
          <label className="field">
            <span>Key</span>
            {text(auth.key, (key) => onChange({ ...auth, key }), { placeholder: "X-API-Key" })}
          </label>
          <label className="field">
            <span>Value {badge("auth.value")}</span>
            {text(auth.value, (value) => onChange({ ...auth, value }), described("auth.value"))}
          </label>
          <label className="field">
            <span>Add to</span>
            <select value={auth.addTo} onChange={(e) => onChange({ ...auth, addTo: e.target.value as "header" | "query" })}>
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </select>
          </label>
        </>
      )}

      {auth.type !== "none" && (
        <p className="muted small">A header you add yourself on the Headers tab takes priority over this.</p>
      )}
    </div>
  );
}
