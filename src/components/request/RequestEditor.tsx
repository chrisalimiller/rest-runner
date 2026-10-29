import { useCallback, useEffect, useId, useRef, useState } from "react";
import { requestToCurl } from "../../lib/curl";
import { findJsonProblem, formatJson } from "../../lib/jsonFormat";
import { readableUrl } from "../../lib/quickOpen";
import { unresolvedPlaceholders } from "../../lib/request";
import { BODY_LABELS, loadDetailsState, requestDetailsSummary, resolvedUrl, rowCounts, splitPlaceholders, type DetailsState, type DetailsTab } from "../../lib/requestSummary";
import { load, save } from "../../lib/storage";
import type { Vars } from "../../lib/template";
import { HTTP_METHODS, type BodyMode, type HttpMethod, type RequestDef } from "../../lib/types";
import { AuthEditor } from "../AuthEditor";
import { BodyEditor } from "../BodyEditor";
import { KeyValueEditor } from "../KeyValueEditor";
import { ScriptEditor } from "../testing/ScriptEditor";
import { OverflowMenu, type MenuItem } from "../shell/OverflowMenu";
import { useToast } from "../shell/Toast";
import { useCertificates } from "../CertificatesDialog";
import { CertificateChip } from "./CertificateChip";
import { CurlPanel } from "./CurlPanel";
import { RequestDetailsDrawer, RequestSummary } from "./RequestDetails";
import { usesPostman } from "../../lib/postmanScripts";
import { UrlInput } from "./UrlInput";

interface Props {
  def: RequestDef;
  onChange: (patch: Partial<RequestDef>) => void;
  envVars: Vars;
  /** Name of the environment the values come from, or undefined for none. */
  envName?: string;
  /** Enter in the URL box. */
  onEnter?: () => void;
  /** Where the Request details drawer's open state and tab are remembered. */
  detailsKey: string;
  urlPlaceholder?: string;
  /** Variables set by scripts on earlier sends, shown under the script editor. */
  scriptVars?: Vars;
  /** Extra line under the script editor, e.g. how request scripts mix with a test case's. */
  scriptsNote?: string;
  /** Opens the Variables sidebar (the unfilled-placeholder dot and the Scripts tab link to it). */
  onOpenVariables?: () => void;
  /** The Send button, shown at the right of the URL row. Left out where the request is not sent from here. */
  sendSlot?: React.ReactNode;
  /** Items at the top of the ⋯ menu next to Send (Save and the like). The URL and cURL items follow. Without them there is no ⋯ menu. */
  menuItems?: MenuItem[];
  /** A curl command was pasted into the URL box. Return true when it was used (the text is then not pasted). */
  onPasteCurl?: (text: string) => boolean;
  /** Shown under the URL row, e.g. what a cURL import did. */
  banner?: React.ReactNode;
}

const POSTMAN_WARNING = "Uses Postman pm.* calls; this script will not run until they are converted";

/** The dot after a script tab name; amber when the script still uses Postman calls. */
function scriptMark(script: string | undefined) {
  if (!(script ?? "").trim()) return "";
  return usesPostman(script ?? "") ? (
    <span className="req-details-mark warn" title={POSTMAN_WARNING}>
      •
    </span>
  ) : (
    " •"
  );
}

/** The Scripts tab: Pre-request / Post-response switch, the editor, and the variables scripts have set. */
function ScriptsPanel({ def, onChange, scriptVars, onOpenVariables, scriptsNote }: Pick<Props, "def" | "onChange" | "scriptVars" | "onOpenVariables" | "scriptsNote">) {
  const [phase, setPhase] = useState<"pre" | "post">(() => ((def.preScript ?? "").trim() === "" && (def.postScript ?? "").trim() !== "" ? "post" : "pre"));
  const varNames = Object.keys(scriptVars ?? {});
  // An emptied script is removed so the request matches its saved copy again.
  const set = (key: "preScript" | "postScript", value: string) => onChange({ [key]: value.trim() === "" ? undefined : value });
  return (
    <div className="req-scripts">
      <div className="segmented" role="tablist" aria-label="Script">
        <button role="tab" aria-selected={phase === "pre"} className={phase === "pre" ? "on" : ""} onClick={() => setPhase("pre")}>
          Pre-request{scriptMark(def.preScript)}
        </button>
        <button role="tab" aria-selected={phase === "post"} className={phase === "post" ? "on" : ""} onClick={() => setPhase("post")}>
          Post-response{scriptMark(def.postScript)}
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
 * The request column: the URL row (with Send and the ⋯ menu), one summary line, and the body filling the rest.
 * Params, Auth, Headers and Scripts live in a Request details drawer that slides over the body. Requests mode
 * and the Testing "Edit request" dialog both use it.
 */
export function RequestEditor({ def, onChange, envVars, envName, onEnter, detailsKey, urlPlaceholder, scriptVars, scriptsNote, onOpenVariables, sendSlot, menuItems, onPasteCurl, banner }: Props) {
  const [details, setDetails] = useState<DetailsState>(() => loadDetailsState(load<unknown>(detailsKey, null)));
  useEffect(() => {
    save(detailsKey, details);
  }, [detailsKey, details]);

  const methodAllowsBody = def.method !== "GET" && def.method !== "HEAD";
  // With no body to cover, the details fill its place and are always showing.
  const docked = !methodAllowsBody;
  const open = details.open || docked;
  const detailsId = useId();
  const opener = useRef<HTMLElement | null>(null);

  const closeDetails = useCallback(() => {
    setDetails((d) => ({ ...d, open: false }));
    requestAnimationFrame(() => {
      const back = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>(".req-details-btn");
      back?.focus();
    });
  }, []);
  const toggleDetails = (from: HTMLElement) => {
    if (details.open) return closeDetails();
    opener.current = from;
    setDetails((d) => ({ ...d, open: true }));
  };
  const pickTab = (tab: DetailsTab, from: HTMLElement) => {
    if (!docked && !details.open) opener.current = from;
    setDetails((d) => ({ ...d, tab, open: docked ? d.open : true }));
  };

  const toast = useToast();
  const copyToClipboard = (text: string, message: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.show({ message }));
  };
  const [curlOpen, setCurlOpen] = useState(() => load<boolean>(CURL_OPEN_KEY, false) === true);
  useEffect(() => {
    save(CURL_OPEN_KEY, curlOpen);
  }, [curlOpen]);

  const certificates = useCertificates();
  const urlInputs = useDebounced({ def, envVars }, 150);
  const finalUrl = resolvedUrl(urlInputs.def, urlInputs.envVars);
  const unfilled = unresolvedPlaceholders(urlInputs.def, urlInputs.envVars);
  const unfilledNames = unfilled.map((n) => `{{${n}}}`).join(", ");

  const problem = def.bodyMode === "json" ? findJsonProblem(def.body) : null;
  const marks: Record<DetailsTab, string> = {
    params: rowCounts(def.params).on ? String(rowCounts(def.params).on) : "",
    auth: def.auth.type !== "none" ? "•" : "",
    headers: rowCounts(def.headers).on ? String(rowCounts(def.headers).on) : "",
    scripts: (def.preScript ?? "").trim() || (def.postScript ?? "").trim() ? "•" : "",
  };

  const postmanWarning = usesPostman(def.preScript ?? "") || usesPostman(def.postScript ?? "") ? POSTMAN_WARNING : undefined;
  const noUrl = def.url.trim() === "";
  const fullMenu: MenuItem[] | undefined = menuItems && [
    ...menuItems,
    { label: "Copy final URL", onSelect: () => copyToClipboard(finalUrl, "Copied the URL"), disabled: !finalUrl, separated: true },
    { label: curlOpen ? "Hide cURL" : "Show cURL", onSelect: () => setCurlOpen((o) => !o) },
    {
      label: "Copy as cURL (Bash)",
      onSelect: () => copyToClipboard(requestToCurl(urlInputs.def, urlInputs.envVars, "bash", certificates).command, "Copied the cURL command (Bash)"),
      disabled: noUrl,
    },
    {
      label: "Copy as cURL (Windows cmd)",
      onSelect: () => copyToClipboard(requestToCurl(urlInputs.def, urlInputs.envVars, "cmd", certificates).command, "Copied the cURL command (Windows cmd)"),
      disabled: noUrl,
    },
  ];

  return (
    <>
      <div className="url-block">
        <div className="url-row">
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
              onPasteCurl={onPasteCurl}
              aria-label="URL"
              title={finalUrl ? readableUrl(finalUrl) : undefined}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && onEnter) onEnter();
              }}
            />
            {unfilled.length > 0 &&
              (onOpenVariables ? (
                <button className="unfilled-dot" onClick={onOpenVariables} title={`No value for ${unfilledNames}. Click to open Variables`} aria-label={`No value for ${unfilledNames}. Open Variables`}>
                  <span className="unfilled-mark" aria-hidden />
                  {unfilled.length}
                </button>
              ) : (
                <span className="unfilled-dot" title={`No value for ${unfilledNames}`} role="img" aria-label={`No value for ${unfilledNames}`}>
                  <span className="unfilled-mark" aria-hidden />
                  {unfilled.length}
                </span>
              ))}
          </div>
          {sendSlot}
          {fullMenu && <OverflowMenu items={fullMenu} label="More actions" />}
        </div>
        {banner}
        {curlOpen && fullMenu && <CurlPanel def={urlInputs.def} vars={urlInputs.envVars} envName={envName} />}
      </div>

      <RequestSummary
        items={requestDetailsSummary(def, envVars)}
        showToggle={!docked}
        open={open}
        detailsId={detailsId}
        onToggle={toggleDetails}
        onPick={pickTab}
        end={
          methodAllowsBody ? (
            <>
              <select className="body-mode-select" value={def.bodyMode} onChange={(e) => onChange({ bodyMode: e.target.value as BodyMode })} aria-label="Body type">
                {BODY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {BODY_LABELS[m]}
                  </option>
                ))}
              </select>
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
          ) : (
            <span className="muted">No body for {def.method}</span>
          )
        }
      >
        <CertificateChip url={finalUrl} skipped={!!def.noCertificate} onSkip={(skip) => onChange({ noCertificate: skip || undefined })} />
      </RequestSummary>

      <div className="req-body-area">
        {methodAllowsBody && (
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
        )}
        <RequestDetailsDrawer id={detailsId} open={open} docked={docked} tab={details.tab} onTab={(tab) => setDetails((d) => ({ ...d, tab }))} onClose={closeDetails} marks={marks} warnings={postmanWarning ? { scripts: postmanWarning } : undefined}>
          {details.tab === "params" && <KeyValueEditor rows={def.params} onChange={(rows) => onChange({ params: rows })} placeholderVars={envVars} />}
          {details.tab === "auth" && <AuthEditor auth={def.auth} onChange={(a) => onChange({ auth: a })} placeholderVars={envVars} />}
          {details.tab === "headers" && <KeyValueEditor rows={def.headers} onChange={(rows) => onChange({ headers: rows })} placeholderVars={envVars} />}
          {details.tab === "scripts" && <ScriptsPanel def={def} onChange={onChange} scriptVars={scriptVars} onOpenVariables={onOpenVariables} scriptsNote={scriptsNote} />}
        </RequestDetailsDrawer>
      </div>
    </>
  );
}
