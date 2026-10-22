import type { AuthConfig } from "../lib/types";

interface Props {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
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

export function AuthEditor({ auth, onChange }: Props) {
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
          <input
            value={auth.token}
            onChange={(e) => onChange({ ...auth, token: e.target.value })}
            placeholder="Token or {{variable}}"
            spellCheck={false}
          />
        </label>
      )}

      {auth.type === "basic" && (
        <>
          <label className="field">
            <span>Username</span>
            <input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} spellCheck={false} />
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
            <input value={auth.key} onChange={(e) => onChange({ ...auth, key: e.target.value })} placeholder="X-API-Key" spellCheck={false} />
          </label>
          <label className="field">
            <span>Value</span>
            <input value={auth.value} onChange={(e) => onChange({ ...auth, value: e.target.value })} spellCheck={false} />
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
