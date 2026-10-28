import type { Vars } from "../lib/template";
import type { AuthConfig } from "../lib/types";
import { PlaceholderInput } from "./PlaceholderInput";

interface Props {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
  /** Values the placeholders can be filled from. With it, {{placeholders}} are drawn and open the variable card on hover. */
  placeholderVars?: Vars;
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

export function AuthEditor({ auth, onChange, placeholderVars }: Props) {
  /** A text field that draws placeholders when it can. */
  const text = (value: string, onValue: (v: string) => void, extra: { placeholder?: string } = {}) =>
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
          <span>Token</span>
          {text(auth.token, (token) => onChange({ ...auth, token }), { placeholder: "Token or {{variable}}" })}
        </label>
      )}

      {auth.type === "basic" && (
        <>
          <label className="field">
            <span>Username</span>
            {text(auth.username, (username) => onChange({ ...auth, username }))}
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
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
            <span>Value</span>
            {text(auth.value, (value) => onChange({ ...auth, value }))}
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
