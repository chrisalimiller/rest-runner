import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./http";

export interface SaveResult {
  saved: boolean;
  path?: string;
}

/**
 * Asks where to save and writes the text there. In the desktop app this uses the
 * native Save dialog; in a plain browser it downloads the file instead.
 */
export async function saveTextFile(defaultName: string, contents: string, filterName: string, extension: string): Promise<SaveResult> {
  if (isTauri()) {
    const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [extension] }] });
    if (!path) return { saved: false };
    await invoke("write_text_file", { path, contents });
    return { saved: true, path };
  }
  const types: Record<string, string> = { html: "text/html", csv: "text/csv", json: "application/json" };
  const blob = new Blob([contents], { type: types[extension] ?? "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { saved: true };
}
