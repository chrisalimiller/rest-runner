/** Wording and state for the manual "Check for updates" dialog. Nothing here talks to the network. */

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** RFC 3339 publish date, when the release has one. */
  date?: string;
  notes?: string;
}

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; info: UpdateInfo }
  /** A run is in progress: ask before stopping it for the restart. */
  | { kind: "confirm-stop"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; received: number; total?: number }
  | { kind: "installing"; info: UpdateInfo }
  | { kind: "error"; message: string };

/** "v0.3.0" for "0.3.0" or "v0.3.0". */
export function versionLabel(version: string): string {
  const v = version.trim().replace(/^v/i, "");
  return v ? `v${v}` : "";
}

/** "12 Nov 2026", or "" when the date is missing or unreadable. */
export function releaseDate(date: string | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Download progress as a whole percent, or null while the total size is unknown. */
export function downloadPercent(received: number, total: number | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}

/** Release notes cleaned for plain display: Windows line ends, markdown heading marks and bold marks removed. */
export function plainNotes(notes: string | undefined): string {
  return (notes ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim();
}

/** A reason a person can read for a failed check or download. */
export function friendlyUpdateError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim();
  const lower = raw.toLowerCase();
  if (/signature/.test(lower)) return "The downloaded update did not pass its signature check, so it was not installed.";
  if (/could not fetch a valid release json|404|not found/.test(lower)) return "No update information was found for the latest release. Try again later, or install it from the GitHub Releases page.";
  if (/network|dns|connect|timed out|timeout|offline|error sending request|tls|certificate|proxy/.test(lower)) {
    return "Could not reach GitHub. Check your connection (or proxy) and try again.";
  }
  if (/permission|denied|read-only/.test(lower)) return "REST Runner could not replace itself here. Move it to the Applications folder (or reinstall it) and try again.";
  return raw ? `The update failed: ${raw}` : "The update failed for an unknown reason.";
}

/** Whether the build can update itself: installed builds only, not `tauri dev` or the browser. */
export function updatesAvailable(inTauri: boolean, isDev: boolean): boolean {
  return inTauri && !isDev;
}
