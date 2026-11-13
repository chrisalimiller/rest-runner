import { useEffect, useMemo, useState } from "react";
import { CURL_SHELL_LABELS, requestToCurl, type CurlShell } from "../../lib/curl";
import { Collapse } from "../Collapse";
import { RainbowText } from "../RainbowText";
import { useCertificates } from "../CertificatesDialog";
import { currentMasker } from "../../lib/secrets";
import { load, save } from "../../lib/storage";
import type { Vars } from "../../lib/template";
import type { RequestDef } from "../../lib/types";

const SHELL_KEY = "rest-runner.curl-shell";
const COLLAPSED_KEY = "rest-runner.curl-collapsed";
const SHELLS: CurlShell[] = ["bash", "cmd"];

function defaultShell(): CurlShell {
  const platform = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /Windows/i.test(platform) ? "cmd" : "bash";
}

interface Props {
  def: RequestDef;
  vars: Vars;
  envName?: string;
}

/** The curl command Send would run, with variables filled in, ready to copy into a terminal. */
export function CurlPanel({ def, vars, envName }: Props) {
  const certificates = useCertificates();
  const [shell, setShell] = useState<CurlShell>(() => load<CurlShell>(SHELL_KEY, defaultShell(), (x) => x === "bash" || x === "cmd"));
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(() => load<boolean>(COLLAPSED_KEY, false) === true);
  useEffect(() => {
    save(COLLAPSED_KEY, collapsed);
  }, [collapsed]);
  useEffect(() => {
    save(SHELL_KEY, shell);
  }, [shell]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const result = useMemo(() => requestToCurl(def, vars, shell, certificates), [def, vars, shell, certificates]);
  const empty = def.url.trim() === "";
  const shown = useMemo(() => currentMasker()(result.command), [result.command]);
  const hasSecret = shown !== result.command;

  const copy = () => {
    void navigator.clipboard?.writeText(result.command).then(() => setCopied(true));
  };

  return (
    <div className={collapsed ? "curl-panel collapsed" : "curl-panel"} aria-label="cURL command">
      <div className="curl-head">
        <div className="segmented" role="tablist" aria-label="Terminal">
          {SHELLS.map((s) => (
            <button key={s} role="tab" aria-selected={shell === s} className={shell === s ? "on" : ""} onClick={() => setShell(s)}>
              {CURL_SHELL_LABELS[s]}
            </button>
          ))}
        </div>
        <span className="muted small">{envName ? `values from ${envName}` : "no environment"}</span>
        <span className="flex-gap" />
        <button className="link-btn small" onClick={copy} disabled={empty || !result.command} title="Copy the command">
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          className="curl-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand cURL" : "Collapse cURL"}
          title={collapsed ? "Expand cURL" : "Collapse cURL"}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <Collapse open={!collapsed}>
      <div className="curl-body">
      {empty ? (
        <p className="muted small">Enter a URL to see the command.</p>
      ) : (
        <pre className="curl-command">
          <RainbowText text={shown} language="plain" />
        </pre>
      )}
      {!empty && hasSecret && <p className="muted small">Secret values are hidden here. Copy puts the real command on your clipboard.</p>}
      {!empty && result.unresolved.length > 0 && (
        <p className="warning small">
          No value for{" "}
          {result.unresolved.map((n) => (
            <code key={n} className="var-chip">{`{{${n}}}`}</code>
          ))}
          , so {result.unresolved.length === 1 ? "it stays" : "they stay"} in the command as written.
        </p>
      )}
      {!empty && result.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
      </div>
      </Collapse>
    </div>
  );
}
