import { invoke } from "@tauri-apps/api/core";
import { explainTlsError, loadCertificates, tlsFor, type CertificateUse, type TlsSpec } from "./certificates";
import { MAX_REDIRECTS, nextHop } from "./redirects";
import type { PreparedRequest, ResponseResult, SendOutcome } from "./types";

/** True inside the desktop app. False when the UI runs in a normal browser (npm run dev). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const CANCELLED = "Request cancelled";

function errorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return CANCELLED;
  if (err instanceof Error) return err.message;
  return String(err);
}

let nextCallId = 0;

/** One call through Rust. Redirects are not followed here. Rejects with a message string. */
async function nativeSend(req: PreparedRequest, tls: TlsSpec | undefined, signal?: AbortSignal): Promise<ResponseResult> {
  if (signal?.aborted) throw new Error(CANCELLED);
  const id = `call-${++nextCallId}`;
  const cancel = () => void invoke("http_cancel", { id }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await invoke<ResponseResult>("http_send", {
      request: {
        id,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body ?? null,
        tls: tls ?? { caIds: [], caOnly: false },
      },
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** Sends the request in the browser, where redirects are followed by fetch itself. */
async function browserSend(req: PreparedRequest, signal?: AbortSignal): Promise<ResponseResult> {
  const start = performance.now();
  const res = await window.fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal,
  });
  const buffer = await res.arrayBuffer();
  const headers: [string, string][] = [];
  res.headers.forEach((value, key) => headers.push([key, value]));
  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    body: new TextDecoder().decode(buffer),
    sizeBytes: buffer.byteLength,
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * Sends a prepared request. In the desktop app the call goes through Rust,
 * so there are no browser CORS limits, and redirects are followed here one hop
 * at a time. In a plain browser it falls back to fetch.
 */
export async function sendRequest(req: PreparedRequest, signal?: AbortSignal): Promise<SendOutcome> {
  const sentAt = new Date().toISOString();
  const start = performance.now();
  let current = req;
  let certificate: CertificateUse | undefined;
  try {
    let response: ResponseResult;
    if (isTauri()) {
      for (let hops = 0; ; hops++) {
        // Matched again on every hop, so a certificate is never shown to a host it was not meant for.
        const chosen = tlsFor(current.url, loadCertificates(), req.noCertificate);
        certificate ??= chosen?.used;
        response = await nativeSend(current, chosen?.tls, signal);
        const next = nextHop(current, response.status, response.headers);
        if (!next) break;
        if (hops >= MAX_REDIRECTS) throw new Error(`Stopped after ${MAX_REDIRECTS} redirects`);
        current = next;
      }
    } else {
      response = await browserSend(req, signal);
    }
    return {
      ok: true,
      request: req,
      sentAt,
      response: { ...response, durationMs: Math.round(performance.now() - start) },
      ...(certificate ? { certificate } : {}),
    };
  } catch (err) {
    let error = errorMessage(err);
    if (isTauri() && error !== CANCELLED) {
      error = explainTlsError(error, { host: hostOf(current.url), usedCertificate: certificate?.name });
    }
    return {
      ok: false,
      request: req,
      sentAt,
      error,
      durationMs: Math.round(performance.now() - start),
      ...(certificate ? { certificate } : {}),
    };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
