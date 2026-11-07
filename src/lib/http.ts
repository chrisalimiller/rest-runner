import { invoke } from "@tauri-apps/api/core";
import { explainTlsError, loadCertificates, tlsFor, type CertificateUse, type TlsSpec } from "./certificates";
import { MAX_REDIRECTS, nextHop } from "./redirects";
import type { PreparedRequest, ResponseResult, SendOutcome } from "./types";
import { load, save } from "./storage";

/** True inside the desktop app. False when the UI runs in a normal browser (npm run dev). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The error of a send the user stopped. */
export const CANCELLED = "Request cancelled";

function errorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return CANCELLED;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Maximum decoded response bytes per request. Higher limits increase memory use in parallel runs. */
export const DEFAULT_RESPONSE_LIMIT = 4 * 1024 * 1024;
export const MAX_RESPONSE_LIMIT = 16 * 1024 * 1024;

const RESPONSE_LIMIT_KEY = "rest-runner.response-limit";
export function getResponseLimit(): number {
  return load(RESPONSE_LIMIT_KEY, DEFAULT_RESPONSE_LIMIT, (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_RESPONSE_LIMIT);
}
export function setResponseLimit(value: number): boolean {
  return save(RESPONSE_LIMIT_KEY, responseLimit(value));
}

function responseLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESPONSE_LIMIT) {
    throw new Error(`Response limit must be between 1 and ${MAX_RESPONSE_LIMIT} bytes`);
  }
  return value;
}

// Limit simultaneous response buffers, including the native IPC copies.
let activeResponses = 0;
const waitingResponses: Array<() => void> = [];
async function responseSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new Error(CANCELLED);
  if (activeResponses >= 4) {
    await new Promise<void>((resolve, reject) => {
      const start = () => { signal?.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => {
        const index = waitingResponses.indexOf(start);
        if (index >= 0) waitingResponses.splice(index, 1);
        reject(new Error(CANCELLED));
      };
      waitingResponses.push(start);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  } else activeResponses++;
  return () => {
    const next = waitingResponses.shift();
    if (next) next();
    else activeResponses--;
  };
}

let nextCallId = 0;

/** One call through Rust. Redirects are not followed here. Rejects with a message string. */
async function nativeSend(req: PreparedRequest, tls: TlsSpec | undefined, limit: number, signal?: AbortSignal): Promise<ResponseResult> {
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
        maxResponseBytes: limit,
        tls: tls ?? { caIds: [], caOnly: false },
      },
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

/** Sends the request in the browser, where redirects are followed by fetch itself. */
async function browserSend(req: PreparedRequest, limit: number, signal?: AbortSignal): Promise<ResponseResult> {
  const start = performance.now();
  const res = await window.fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal,
  });
  const reader = res.body?.getReader();
  let buffer = new Uint8Array(Math.min(limit, 65536));
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength > limit - size) throw new Error(`Response exceeded ${limit} bytes`);
        const needed = size + value.byteLength;
        if (needed > buffer.length) {
          const grown = new Uint8Array(Math.min(limit, Math.max(needed, buffer.length * 2)));
          grown.set(buffer.subarray(0, size));
          buffer = grown;
        }
        buffer.set(value, size);
        size = needed;
      }
    } catch (err) {
      void reader.cancel().catch(() => {});
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
  const body = new TextDecoder().decode(buffer.subarray(0, size));
  const headers: [string, string][] = [];
  res.headers.forEach((value, key) => headers.push([key, value]));
  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    body,
    sizeBytes: size,
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * Sends a prepared request. In the desktop app the call goes through Rust,
 * so there are no browser CORS limits, and redirects are followed here one hop
 * at a time. In a plain browser it falls back to fetch.
 */
export async function sendRequest(req: PreparedRequest, signal?: AbortSignal, maxResponseBytes = getResponseLimit()): Promise<SendOutcome> {
  const sentAt = new Date().toISOString();
  const start = performance.now();
  let current = req;
  let certificate: CertificateUse | undefined;
  let firstHopAdded: [string, string][] = [];
  try {
    const limit = responseLimit(maxResponseBytes);
    const release = await responseSlot(signal);
    try {
      let response: ResponseResult;
    if (isTauri()) {
      for (let hops = 0; ; hops++) {
        // Matched again on every hop, so a certificate is never shown to a host it was not meant for.
        const chosen = tlsFor(current.url, loadCertificates(), req.noCertificate);
        certificate ??= chosen?.used;
        response = await nativeSend(current, chosen?.tls, limit, signal);
        if (hops === 0) firstHopAdded = response.addedHeaders ?? [];
        const next = nextHop(current, response.status, response.headers);
        if (!next) break;
        if (hops >= MAX_REDIRECTS) throw new Error(`Stopped after ${MAX_REDIRECTS} redirects`);
        current = next;
      }
    } else {
      response = await browserSend(req, limit, signal);
    }
    // The first hop's request is the one the user wrote; list the headers the app added to it, in send order.
    const added = firstHopAdded;
    const { addedHeaders: _unused, ...responseRest } = response;
    void _unused;
    return {
      ok: true,
      request: added.length ? { ...req, headers: [...added, ...req.headers] } : req,
      sentAt,
      response: { ...responseRest, durationMs: Math.round(performance.now() - start) },
      ...(current.url !== req.url ? { finalUrl: current.url } : {}),
      ...(certificate ? { certificate } : {}),
    };
    } finally { release(); }
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
