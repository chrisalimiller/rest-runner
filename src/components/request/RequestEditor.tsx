import { useCallback, useEffect, useRef, useState } from "react";
import { requestToCurl } from "../../lib/curl";
import { findJsonProblem, formatJson } from "../../lib/jsonFormat";
import { readableUrl } from "../../lib/quickOpen";
import { unresolvedPlaceholders } from "../../lib/request";
import { activeSection, authSummary, BODY_LABELS, bodySummary, countsLabel, headersText, paramsText, resolvedUrl, rowCounts, sectionBarItems, splitPlaceholders } from "../../lib/requestSummary";
import { load, save } from "../../lib/storage";
import type { Vars } from "../../lib/template";
import { HTTP_METHODS, type BodyMode, type HttpMethod, type RequestDef } from "../../lib/types";
import { AuthEditor } from "../AuthEditor";
import { BodyEditor } from "../BodyEditor";
import { KeyValueEditor } from "../KeyValueEditor";
import { ScriptEditor } from "../testing/ScriptEditor";
import { ChevronDownIcon, CopyIcon } from "../shell/Icons";
import { OverflowMenu } from "../shell/OverflowMenu";
import { useToast } from "../shell/Toast";
import { CertificateChip } from "./CertificateChip";
import { CurlPanel } from "./CurlPanel";
import { UrlInput } from "./UrlInput";
import { Section } from "./Section";

type SectionId = "params" | "auth" | "headers" | "body" | "scripts";
type OpenState = Partial<Record<SectionId, boolean>>;

interface Props {
  def: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
  envVars: Vars;
  /** Name of the environment the values come from, or undefined for none. */
  envName?: string;
  /** Enter in the URL box. */
  onEnter?: () => void;
  /** Where the open/closed sections are remembered. */
  sectionsKey: string;
  urlPlaceholder?: string;
  /** Variables set by scripts on earlier sends, shown under the script editor. */
  scriptVars?: Vars;
  /** Extra line under the script editor, e.g. how request scripts mix with a test case's. */
  scriptsNote?: string;
  /** Opens the Variables popover (the unfilled-placeholder chip and the Scripts section link to it). */
  onOpenVariables?: () => void;
}

/** The Scripts section: Pre-request / Post-response switch, the editor, and the variables scripts have set. */
function ScriptsPanel({ def, onChange, scriptVars, onOpenVariables, scriptsNote }: Pick<Props, "def" | "onChange" | "scriptVars" | "onOpenVariables" | "scriptsNote">) {
  const [phase, setPhase] = useState<"pre" | "post">(() => ((def.preScript ?? "").trim() === "" && (def.postScript ?? "").trim() !== "" ? "post" : "pre"));
  const varNames = Object.keys(scriptVars ?? {});
  // An emptied script is removed so the request matches its saved copy again.
  const set = (key: "preScript" | "postScript", value: string) => onChange({ [key]: value.trim() === "" ? undefined : value });
  return (
    <div className="req-scripts">
      <div className="segmented" role="tablist" aria-label="Script">
        <button role="tab" aria-selected={phase === "pre"} className={phase === "pre" ? "on" : ""} onClick={() => setPhase("pre")}>
          Pre-request{(def.preScript ?? "").trim() ? " •" : ""}
        </button>
        <button role="tab" aria-selected={phase === "post"} className={phase === "post" ? "on" : ""} onClick={() => setPhase("post")}>
          Post-response{(def.postScript ?? "").trim() ? " •" : ""}
        </button>
      </div>
      {phase === "pre" ? (
        <ScriptEditor key="pre" context="request" phase="pre" value={def.preScript ?? ""} onChange={(v) => set("preScript", v)} />
      ) : (
        <ScriptEditor key="post" context="request" phase="post" value={def.postScript ?? ""} onChange={(v) => set("postScript", v)} />
      )}
      {scriptsNote && <p className="muted small">{scriptsNote}</p>}
      {scriptVars && onOpenVariables && (
        <p className="small script-vars">
          <span className="muted">{varNames.length === 0 ? "No script variables yet." : `${varNames.length} script variable${varNames.length === 1 ? "" : "s"}.`}</span>{" "}
          <button className="link-btn small" onClick={onOpenVariables}>
            Open Variables
          </button>
        </p>
      )}
    </div>
  );
}

/** Text with {{placeholders}} drawn in the placeholder style. */
export function WithPlaceholders({ text, vars }: { text: string; vars?: Vars }) {
  return (
    <>
      {splitPlaceholders(text, vars).map((p, i) =>
        p.placeholder ? (
          <span key={i} className={p.resolved === false ? "ph missing" : "ph"} title={p.resolved === false ? "No value for this yet" : undefined}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const BODY_MODES: BodyMode[] = ["none", "json", "text", "urlencoded"];
const CURL_OPEN_KEY = "rest-runner.curl-open";

/**
 * The request column of layout A: URL bar, the resolved URL, and Params / Auth /
 * Headers / Body / Scripts as collapsible sections. Requests mode and the Testing "Edit request"
 * dialog both use it.
 */
export function RequestEditor({ def, onChange, envVars, envName, onEnter, sectionsKey, urlPlaceholder, scriptVars, scriptsNote, onOpenVariables }: Props) {
  const [openState, setOpenState] = useState<OpenState>(() => load<OpenState>(sectionsKey, {}));
  useEffect(() => {
    save(sectionsKey, openState);
  }, [sectionsKey, openState]);

  const scroller = useRef<HTMLDivElement>(null);
  const [spy, setSpy] = useState<SectionId | null>("params");
  /** Which section is at the top of the scrolling area. */
  const readSpy = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    const tops = [...box.querySelectorAll<HTMLElement>("[data-section]")].map((el) => ({ id: el.dataset.section as SectionId, top: el.getBoundingClientRect().top - top }));
    setSpy(activeSection(tops));
  }, []);
  const jumpTo = (id: SectionId) => {
    setOpenState((s) => ({ ...s, [id]: true }));
    requestAnimationFrame(() => {
      const box = scroller.current;
      const el = box?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (box && el) box.scrollTo({ top: el.offsetTop - box.offsetTop, behavior: "smooth" });
      setSpy(id);
    });
  };

  const methodAllowsBody = def.method !== "GET" && def.method !== "HEAD";
  const isOpen = (id: SectionId) => openState[id] ?? (methodAllowsBody ? id === "body" : id === "params");
  const toggle = (id: SectionId) => setOpenState((s) => ({ ...s, [id]: !isOpen(id) }));

  const toast = useToast();
  const copyToClipboard = (text: string, message: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.show({ message }));
  };
  const [curlOpen, setCurlOpen] = useState(() => load<boolean>(CURL_OPEN_KEY, false));
  useEffect(() => {
    save(CURL_OPEN_KEY, curlOpen);
  }, [curlOpen]);

  const urlInputs = useDebounced({ def, envVars }, 150);
  const finalUrl = resolvedUrl(urlInputs.def, urlInputs.envVars);

  const unfilled = unresolvedPlaceholders(urlInputs.def, urlInputs.envVars);

  const params = rowCounts(def.params);
  const headers = rowCounts(def.headers);
  const auth = authSummary(def.auth);
  const body = bodySummary(def);
  const problem = def.bodyMode === "json" ? findJsonProblem(def.body) : null;
  const scriptNames = [(def.preScript ?? "").trim() && "Pre-request", (def.postScript ?? "").trim() && "Post-response"].filter(Boolean).join(" · ");

  return (
    <>
      <div className="url-block">
        <div className="url-bar">
          <select
            className={`method-select m-${def.method.toLowerCase()}`}
            value={def.method}
            onChange={(e) => onChange({ method: e.target.value as HttpMethod })}
            aria-label="Method"
          >
            {HTTP_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <UrlInput
            value={def.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder={urlPlaceholder ?? "Enter URL, e.g. https://api.example.com/users"}
            spellCheck={false}
            aria-label="URL"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && onEnter) onEnter();
            }}
          />
        </div>
        <div className="resolved-url" aria-label="Resolved URL" title="The URL Send will use">
          {finalUrl ? (
            <>
              <span className="resolved-arrow" aria-hidden>
                →
              </span>
              <span className="resolved-text" title={finalUrl}>
                <WithPlaceholders text={readableUrl(finalUrl)} vars={urlInputs.envVars} />
              </span>
              <button className="icon-btn resolved-copy" onClick={() => copyToClipboard(finalUrl, "Copied the URL")} aria-label="Copy the full URL" title={`Copy the full URL\n${finalUrl}`}>
                <CopyIcon size={12} />
              </button>
              {unfilled.length > 0 && (
                <button
                  className="unfilled-chip"
                  onClick={onOpenVariables}
                  title={`No value for: ${unfilled.map((n) => `{{${n}}}`).join(", ")}${onOpenVariables ? "\nClick to open Variables" : ""}`}
                >
                  {unfilled.length === 1 ? `1 unfilled: ${unfilled[0]}` : `${unfilled.length} unfilled`}
                </button>
              )}
              <CertificateChip url={finalUrl} skipped={!!def.noCertificate} onSkip={(skip) => onChange({ noCertificate: skip || undefined })} />
              <span className="resolved-legend">{envName ? `values from ${envName}` : "no environment"}</span>
            </>
          ) : (
            <span className="muted resolved-empty">The final URL, with environment values and query params filled in, shows here.</span>
          )}
          <OverflowMenu
            label="cURL"
            triggerClass={`link-btn small curl-toggle ${curlOpen ? "active" : ""}`}
            triggerTitle="Show or copy the cURL command Send would run"
            trigger={
              <>
                cURL <ChevronDownIcon size={10} />
              </>
            }
            items={[
              { label: curlOpen ? "Hide cURL" : "Show cURL", onSelect: () => setCurlOpen((o) => !o) },
              {
                label: "Copy as cURL (Bash)",
                onSelect: () => copyToClipboard(requestToCurl(urlInputs.def, urlInputs.envVars, "bash").command, "Copied the cURL command (Bash)"),
                disabled: def.url.trim() === "",
                separated: true,
              },
              {
                label: "Copy as cURL (Windows cmd)",
                onSelect: () => copyToClipboard(requestToCurl(urlInputs.def, urlInputs.envVars, "cmd").command, "Copied the cURL command (Windows cmd)"),
                disabled: def.url.trim() === "",
              },
            ]}
          />
        </div>
        {curlOpen && <CurlPanel def={urlInputs.def} vars={urlInputs.envVars} envName={envName} />}
      </div>

      <nav className="section-bar" aria-label="Jump to a section">
        {sectionBarItems(def).map((item) => (
          <button
            key={item.id}
            className={`section-chip ${spy === item.id ? "current" : ""}`}
            aria-current={spy === item.id ? "true" : undefined}
            onClick={() => jumpTo(item.id)}
          >
            {item.label}
            {item.mark && <span className="section-chip-mark">{item.mark}</span>}
          </button>
        ))}
      </nav>

      <div className="req-sections" ref={scroller} onScroll={readSpy}>
        <Section
          id="params"
          label="Params"
          open={isOpen("params")}
          onToggle={() => toggle("params")}
          summary={
            paramsText(def.params) ? (
              <span className="mono">
                <WithPlaceholders text={paramsText(def.params)} vars={envVars} />
              </span>
            ) : (
              <span className="muted">None</span>
            )
          }
          meta={countsLabel(params)}
        >
          <KeyValueEditor rows={def.params} onChange={(rows) => onChange({ params: rows })} placeholderVars={envVars} />
        </Section>

        <Section
          id="auth"
          label="Auth"
          open={isOpen("auth")}
          onToggle={() => toggle("auth")}
          summary={
            <>
              <span className="muted">{auth.label}</span>
              {auth.value && (
                <span className="mono">
                  <WithPlaceholders text={auth.value} vars={envVars} />
                </span>
              )}
            </>
          }
        >
          <AuthEditor auth={def.auth} onChange={(a) => onChange({ auth: a })} />
        </Section>

        <Section id="headers" label="Headers" open={isOpen("headers")} onToggle={() => toggle("headers")} summary={
            headersText(def.headers) ? (
              <span className="mono">
                <WithPlaceholders text={headersText(def.headers)} vars={envVars} />
              </span>
            ) : (
              <span />
            )
          }
          meta={countsLabel(headers) || "None"}
        >
          <KeyValueEditor rows={def.headers} onChange={(rows) => onChange({ headers: rows })} placeholderVars={envVars} />
        </Section>

        <Section
          id="body"
          label="Body"
          grow
          open={isOpen("body")}
          onToggle={() => toggle("body")}
          summary={
            <>
              <span className="muted">{body.label}</span>
              {body.status && <span className={`json-status ${body.status === "valid" ? "ok" : "bad"}`}>{body.status === "valid" ? "Valid" : "Invalid JSON"}</span>}
              {!methodAllowsBody && def.bodyMode !== "none" && <span className="warning small">not sent with {def.method}</span>}
            </>
          }
          controls={
            <>
              <select className="body-mode-select" value={def.bodyMode} onChange={(e) => onChange({ bodyMode: e.target.value as BodyMode })} aria-label="Body type">
                {BODY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {BODY_LABELS[m]}
                  </option>
                ))}
              </select>
              <span className="req-section-fill" />
              {def.bodyMode === "json" && def.body.trim() !== "" && <span className={`json-status ${problem ? "bad" : "ok"}`}>{problem ? "Invalid JSON" : "Valid"}</span>}
              {def.bodyMode === "json" && (
                <button
                  className="link-btn small"
                  onClick={() => {
                    const formatted = formatJson(def.body);
                    if (formatted !== null) onChange({ body: formatted });
                  }}
                  disabled={problem !== null || def.body.trim() === ""}
                  title="Format (Shift+Alt+F)"
                >
                  Format
                </button>
              )}
            </>
          }
        >
          <BodyEditor
            toolbar={false}
            mode={def.bodyMode}
            body={def.body}
            formBody={def.formBody}
            placeholderVars={envVars}
            methodAllowsBody={methodAllowsBody}
            onModeChange={(bodyMode) => onChange({ bodyMode })}
            onBodyChange={(b) => onChange({ body: b })}
            onFormChange={(formBody) => onChange({ formBody })}
          />
        </Section>

        <Section
          id="scripts"
          label="Scripts"
          open={isOpen("scripts")}
          onToggle={() => toggle("scripts")}
          summary={scriptNames ? <span className="mono">{scriptNames}</span> : <span className="muted">None</span>}
        >
          <ScriptsPanel def={def} onChange={onChange} scriptVars={scriptVars} onOpenVariables={onOpenVariables} scriptsNote={scriptsNote} />
        </Section>
      </div>
    </>
  );
}
