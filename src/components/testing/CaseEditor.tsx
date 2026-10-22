import { useState } from "react";
import type { CaseResult, TestCase } from "../../lib/testing/types";
import { HTTP_METHODS, type HttpMethod, type RequestDef } from "../../lib/types";
import { AuthEditor } from "../AuthEditor";
import { BodyEditor } from "../BodyEditor";
import { countActive, KeyValueEditor } from "../KeyValueEditor";
import { AssertionEditor } from "./AssertionEditor";
import { CaseResultView } from "./CaseResultView";
import { ScriptEditor } from "./ScriptEditor";

type Tab = "params" | "auth" | "headers" | "body" | "pre" | "assertions" | "post";

interface Props {
  testCase: TestCase;
  onChange: (tc: TestCase) => void;
  /** Sends this one case (with its scripts and assertions) using the first CSV row, if any. */
  onTry: () => void;
  trying: boolean;
  tryResult: CaseResult | null;
  /** Name of the saved request this case was copied from, when it still exists. */
  sourceName?: string;
  onRefreshFromSource?: () => void;
}

export function CaseEditor({ testCase: tc, onChange, onTry, trying, tryResult, sourceName, onRefreshFromSource }: Props) {
  const [tab, setTab] = useState<Tab>("assertions");
  const def = tc.request;
  const patchReq = (p: Partial<RequestDef>) => onChange({ ...tc, request: { ...def, ...p } });
  const label = (name: string, count: number) => (count > 0 ? `${name} (${count})` : name);
  const methodAllowsBody = def.method !== "GET" && def.method !== "HEAD";
  const activeAssertions = tc.assertions.filter((a) => a.enabled).length;

  return (
    <div className="case-editor">
      <div className="case-head">
        <input className="request-name" value={tc.name} onChange={(e) => onChange({ ...tc, name: e.target.value })} aria-label="Test case name" />
        {sourceName && (
          <span className="muted small case-source" title="This case has its own copy of the request. Changes here do not change the saved request.">
            Copied from {sourceName}
            {onRefreshFromSource && (
              <>
                {" · "}
                <button
                  className="link-btn"
                  onClick={() => {
                    if (window.confirm(`Replace this case's request with the current version of "${sourceName}"? Scripts and assertions are kept.`)) onRefreshFromSource();
                  }}
                >
                  Update from saved request
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <div className="request-bar">
        <select className={`method-select m-${def.method.toLowerCase()}`} value={def.method} onChange={(e) => patchReq({ method: e.target.value as HttpMethod })} aria-label="Method">
          {HTTP_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="url-input"
          value={def.url}
          onChange={(e) => patchReq({ url: e.target.value })}
          placeholder="Enter URL, e.g. {{baseUrl}}/users/{{id}}"
          spellCheck={false}
          aria-label="URL"
        />
        {trying ? (
          <button className="send" disabled>
            Running…
          </button>
        ) : (
          <button className="send" onClick={onTry} disabled={def.url.trim() === ""} title="Send this case once, with its scripts and assertions">
            Try case
          </button>
        )}
      </div>

      <section className="request-config case-config">
        <div className="tabs">
          <button className={tab === "params" ? "active" : ""} onClick={() => setTab("params")}>
            {label("Params", countActive(def.params))}
          </button>
          <button className={tab === "auth" ? "active" : ""} onClick={() => setTab("auth")}>
            Authorization{def.auth.type !== "none" ? " •" : ""}
          </button>
          <button className={tab === "headers" ? "active" : ""} onClick={() => setTab("headers")}>
            {label("Headers", countActive(def.headers))}
          </button>
          <button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}>
            Body{def.bodyMode !== "none" ? " •" : ""}
          </button>
          <span className="tab-gap" />
          <button className={tab === "pre" ? "active" : ""} onClick={() => setTab("pre")}>
            Pre-request{tc.preScript.trim() ? " •" : ""}
          </button>
          <button className={tab === "assertions" ? "active" : ""} onClick={() => setTab("assertions")}>
            {label("Assertions", activeAssertions)}
          </button>
          <button className={tab === "post" ? "active" : ""} onClick={() => setTab("post")}>
            Post-response{tc.postScript.trim() ? " •" : ""}
          </button>
        </div>
        <div className="tab-panel">
          {tab === "params" && <KeyValueEditor rows={def.params} onChange={(params) => patchReq({ params })} />}
          {tab === "auth" && <AuthEditor auth={def.auth} onChange={(auth) => patchReq({ auth })} />}
          {tab === "headers" && <KeyValueEditor rows={def.headers} onChange={(headers) => patchReq({ headers })} />}
          {tab === "body" && (
            <BodyEditor
              mode={def.bodyMode}
              body={def.body}
              formBody={def.formBody}
              methodAllowsBody={methodAllowsBody}
              onModeChange={(bodyMode) => patchReq({ bodyMode })}
              onBodyChange={(body) => patchReq({ body })}
              onFormChange={(formBody) => patchReq({ formBody })}
            />
          )}
          {tab === "pre" && <ScriptEditor phase="pre" value={tc.preScript} onChange={(preScript) => onChange({ ...tc, preScript })} />}
          {tab === "assertions" && <AssertionEditor assertions={tc.assertions} onChange={(assertions) => onChange({ ...tc, assertions })} />}
          {tab === "post" && <ScriptEditor phase="post" value={tc.postScript} onChange={(postScript) => onChange({ ...tc, postScript })} />}
        </div>
      </section>

      <section className="case-try">
        {tryResult ? (
          <CaseResultView key={tryResult.startedAt} result={tryResult} title="Last try" />
        ) : (
          <p className="muted small pad">
            Press <b>Try case</b> to send this case once and see its checks. Variables set by earlier cases are not available when trying one case on
            its own.
          </p>
        )}
      </section>
    </div>
  );
}
