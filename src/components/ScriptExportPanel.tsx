import { useEffect, useMemo, useState } from "react";
import { saveTextFile } from "../lib/saveFile";
import { buildScript, SCRIPT_LANGUAGES, scriptExportNotes, scriptFileName, scriptRunCommand, type ScriptExportInput, type ScriptLanguage } from "../lib/scriptExport";
import { load, save } from "../lib/storage";
import { CodeEditor } from "./CodeEditor";

const LANGUAGE_KEY = "rest-runner.script-export-language";
const LANGUAGES = Object.keys(SCRIPT_LANGUAGES) as ScriptLanguage[];

interface Props {
  input: ScriptExportInput;
}

/** The batch as a Python or Bash script: shown in the app to copy, or saved to a file. */
export function ScriptExportPanel({ input }: Props) {
  const [language, setLanguage] = useState<ScriptLanguage>(() => {
    const saved = load<ScriptLanguage>(LANGUAGE_KEY, "python");
    return saved in SCRIPT_LANGUAGES ? saved : "python";
  });
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    save(LANGUAGE_KEY, language);
    setStatus(null);
  }, [language]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  // Rebuilt when the request, options, environment or CSV change, so the view always matches what Save would write.
  const script = useMemo(() => buildScript(language, input), [language, input]);
  const notes = scriptExportNotes(input);
  const { label, filterName, extension } = SCRIPT_LANGUAGES[language];
  const windows = navigator.userAgent.includes("Windows");
  const fileName = scriptFileName(input.def, language);

  const copy = () => {
    setStatus(null);
    void navigator.clipboard?.writeText(script).then(
      () => setCopied(true),
      (e: unknown) => setStatus({ ok: false, text: `Could not copy the script: ${e instanceof Error ? e.message : String(e)}` }),
    );
  };

  const saveScript = async () => {
    setStatus(null);
    try {
      const result = await saveTextFile(fileName, script, filterName, extension);
      if (!result.saved) return;
      const savedName = result.path?.split(/[\\/]/).pop() ?? fileName;
      const command = scriptRunCommand(language, savedName, input.csvName, windows);
      setStatus({ ok: true, text: `Saved${result.path ? ` to ${result.path}` : ""}. Run it in a terminal with: ${command}` });
    } catch (e) {
      setStatus({ ok: false, text: `Could not save the script: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <div className="batch-export" aria-label="Export script">
      <p className="small">
        Run this batch in a terminal without the app. Copy the script below, or save it to a file. It sends the request once per row of a CSV you
        give it, with the options above, and writes a results CSV like the app's CSV report. Python needs Python 3.8 or newer. Bash needs curl;
        on Windows run it in Git Bash or WSL.
      </p>
      {notes.map((note) => (
        <p key={note} className="warning small">
          {note}
        </p>
      ))}
      <div className="script-export-head">
        <div className="segmented" role="tablist" aria-label="Script language">
          {LANGUAGES.map((lang) => (
            <button key={lang} role="tab" aria-selected={language === lang} className={language === lang ? "on" : ""} onClick={() => setLanguage(lang)}>
              {SCRIPT_LANGUAGES[lang].label}
            </button>
          ))}
        </div>
        <span className="muted small mono">{fileName}</span>
        <span className="flex-gap" />
        <button className="link-btn small" onClick={copy} title={`Copy the ${label} script`}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="secondary" onClick={() => void saveScript()} title={`Save the ${label} script to a file`}>
          Save to file…
        </button>
      </div>
      <div className="code-view-frame script-export-code">
        <CodeEditor value={script} language={language} readOnly ariaLabel={`${label} script`} />
      </div>
      <p className="muted small">
        To run a copied script, paste it into a file named <code>{fileName}</code>, then run{" "}
        <code>{scriptRunCommand(language, fileName, input.csvName, windows)}</code>.
      </p>
      {status && <p className={`small ${status.ok ? "muted" : "warning"}`}>{status.text}</p>}
    </div>
  );
}
