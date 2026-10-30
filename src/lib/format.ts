export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Splits a formatted size into its number and unit, e.g. 1536 -> { value: "1.5", unit: "KB" }. */
export function splitBytes(bytes: number): { value: string; unit: string } {
  const [value, unit] = formatBytes(bytes).split(" ");
  return { value, unit };
}

/** Pretty-prints JSON when the body parses as JSON; otherwise returns it unchanged. */
export function prettyBody(body: string): { text: string; isJson: boolean } {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
    } catch {
      // not JSON
    }
  }
  return { text: body, isJson: false };
}

export function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  return "bad";
}
