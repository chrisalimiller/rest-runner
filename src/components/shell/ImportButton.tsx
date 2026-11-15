import { useRef } from "react";

/** "Import" in a sidebar: a real button (reachable by keyboard) that opens the file picker of a hidden input. */
export function ImportButton({ title, onImport }: { title: string; onImport: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="link-btn" title={title} onClick={() => input.current?.click()}>
        Import
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
