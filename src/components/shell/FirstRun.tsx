import { useRef, useState } from "react";
import sample from "../../assets/sample-workspace.json";
import { useFocusTrap } from "../useFocusTrap";
import { importWorkspace } from "../../lib/workspace";
import { markOnboarded, readWorkspace, selectEnvironmentEverywhere, writeWorkspace } from "../../lib/workspaceStore";

interface Props {
  /** Called after something was imported (so every mode reads storage again) or the screen was dismissed. */
  onDone: (changed: boolean) => void;
}

/** Shown once on a fresh install: bring in a teammate's workspace file, try the sample, or start empty. */
export function FirstRun({ onDone }: Props) {
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useFocusTrap(card);

  const bringIn = (text: string, name: string, selectEnv?: string) => {
    try {
      const result = importWorkspace(text, readWorkspace());
      if (!writeWorkspace(result)) throw new Error("local storage is full");
      markOnboarded();
      if (selectEnv) selectEnvironmentEverywhere(selectEnv);
      onDone(true);
    } catch (e) {
      setError(`Could not import ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="first-run" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
      <div className="first-run-card" ref={card}>
        <h1 id="first-run-title">Welcome to REST Runner</h1>
        <p className="muted">Send requests, run them against a CSV, check the responses, and chain it all into flows. How do you want to start?</p>
        <div className="first-run-choices">
          <button className="first-run-choice" onClick={() => fileInput.current?.click()}>
            <strong>Import a shared workspace</strong>
            <span>Pick a file a teammate exported: collections, environments, test suites and flows. Secret values are never in the file.</span>
          </button>
          <button className="first-run-choice" onClick={() => bringIn(JSON.stringify(sample), "the sample workspace", sample.environments[0].id)}>
            <strong>Open the sample workspace</strong>
            <span>A few requests, a test suite and a flow against a public echo API. Nothing to set up.</span>
          </button>
          <button
            className="first-run-choice"
            onClick={() => {
              markOnboarded();
              onDone(false);
            }}
          >
            <strong>Start empty</strong>
            <span>Begin with a blank request.</span>
          </button>
        </div>
        {error && (
          <p className="first-run-error" role="alert">
            {error}
          </p>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) bringIn(await f.text(), f.name);
          }}
        />
      </div>
    </div>
  );
}
