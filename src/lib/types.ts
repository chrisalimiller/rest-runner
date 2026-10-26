import type { CertificateUse } from "./certificates";
import type { ScriptOutput } from "./testing/types";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  /** Environment variables only: the value is masked on screen and left out of exports. Missing means not secret. */
  secret?: boolean;
}

export type BodyMode = "none" | "json" | "text" | "urlencoded";

export type AuthConfig =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; key: string; value: string; addTo: "header" | "query" };

/** A request as the user edits it. Values may contain {{placeholders}}. */
export interface RequestDef {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  bodyMode: BodyMode;
  body: string;
  formBody: KeyValue[];
  auth: AuthConfig;
  /** JavaScript run before the request is sent (same `rr` API as test cases). Missing on older saved requests. */
  preScript?: string;
  /** JavaScript run after the response arrives. */
  postScript?: string;
  /** Send without the client certificate that would match this URL (CAs still apply). Missing means use it. */
  noCertificate?: boolean;
}

/** A request with placeholders filled in and auth applied, ready to send. */
export interface PreparedRequest {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  body?: string;
  /** Mirrors RequestDef.noCertificate. */
  noCertificate?: boolean;
}

export interface ResponseResult {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  sizeBytes: number;
  durationMs: number;
}

export type SendOutcome =
  | { ok: true; request: PreparedRequest; response: ResponseResult; sentAt: string; certificate?: CertificateUse }
  | { ok: false; request: PreparedRequest; error: string; durationMs: number; sentAt: string; certificate?: CertificateUse };

export interface HistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  status: number | null;
  sentAt: string;
  def: RequestDef;
  /** Added later; older entries don't have these. */
  durationMs?: number;
  /** Name of the environment selected when it was sent. Older entries don't have it. */
  environmentName?: string;
  /** The response, with its body cut to a size local storage can hold. */
  response?: ResponseResult;
  /** Why no response came back. */
  error?: string;
  /** What the request's scripts did on this send. */
  preScript?: ScriptOutput;
  postScript?: ScriptOutput;
}
