import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { PreparedRequest, SendOutcome } from "./types";

/** True inside the desktop app. False when the UI runs in a normal browser (npm run dev). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "Request cancelled";
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Sends a prepared request. In the desktop app the call goes through Rust,
 * so there are no browser CORS limits. In a plain browser it falls back to fetch.
 */
export async function sendRequest(req: PreparedRequest, signal?: AbortSignal): Promise<SendOutcome> {
  const sentAt = new Date().toISOString();
  const start = performance.now();
  const doFetch = isTauri() ? tauriFetch : window.fetch.bind(window);
  try {
    const res = await doFetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal,
    });
    const buffer = await res.arrayBuffer();
    const durationMs = Math.round(performance.now() - start);
    const headers: [string, string][] = [];
    res.headers.forEach((value, key) => headers.push([key, value]));
    return {
      ok: true,
      request: req,
      sentAt,
      response: {
        status: res.status,
        statusText: res.statusText,
        headers,
        body: new TextDecoder().decode(buffer),
        sizeBytes: buffer.byteLength,
        durationMs,
      },
    };
  } catch (err) {
    return {
      ok: false,
      request: req,
      sentAt,
      error: errorMessage(err),
      durationMs: Math.round(performance.now() - start),
    };
  }
}
