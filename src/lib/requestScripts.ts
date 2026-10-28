import { stripJsonComments } from "./jsonFormat";
import type { SendFn } from "./batch";
import { prepareRequest } from "./request";
import type { Vars } from "./template";
import type { ScriptContext } from "./testing/sandbox";
import { createWorkerScriptRunner, type ScriptRunner } from "./testing/scriptRunner";
import type { ScriptOutput } from "./testing/types";
import type { RequestDef, SendOutcome } from "./types";

/** How long a request's script may run before it is stopped. Same default as test suites. */
export const REQUEST_SCRIPT_TIMEOUT_MS = 5000;

export function hasScripts(def: RequestDef): boolean {
  return (def.preScript ?? "").trim() !== "" || (def.postScript ?? "").trim() !== "";
}

/**
 * Joins scripts (a request's own, then a test case's, …) so they run in one go, in the order given.
 * Each part sits in its own block so their `const` names cannot clash.
 */
export function combineScripts(...scripts: (string | undefined)[]): string {
  const parts = scripts.filter((s): s is string => !!s && s.trim() !== "");
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.map((p) => `{\n${p}\n}`).join("\n");
}

export interface ScriptedSendInput {
  def: RequestDef;
  /** Environment variables (read-only to scripts). */
  env: Vars;
  /** The CSV row, or {} for a single send (read-only to scripts). */
  data: Vars;
  /** Variables scripts can change. Not changed in place; the result carries the new set. */
  vars: Vars;
  iteration: number;
  send: SendFn;
  scripts: ScriptRunner;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ScriptedSendResult {
  /** When the pre-request script failed this is a made-up error outcome for the request that was not sent. */
  outcome: SendOutcome;
  /** False when the pre-request script failed and nothing was sent. */
  sent: boolean;
  preScript?: ScriptOutput;
  postScript?: ScriptOutput;
  /** Script variables after both scripts ran. */
  vars: Vars;
  /** A script threw, timed out, or one of its rr.test checks failed. */
  scriptFailed: boolean;
}

function scriptContext(phase: "pre" | "post", input: ScriptedSendInput, vars: Vars): ScriptContext {
  const def = input.def;
  return {
    phase,
    vars: { ...vars },
    data: input.data,
    env: input.env,
    iteration: input.iteration,
    caseName: def.name,
    request: {
      method: def.method,
      url: def.url,
      headers: def.headers.filter((h) => h.enabled && h.key.trim() !== "").map((h) => [h.key, h.value] as [string, string]),
      body: def.bodyMode === "none" ? undefined : def.bodyMode === "json" ? stripJsonComments(def.body) : def.body,
    },
  };
}

function outputFailed(o: ScriptOutput | undefined): boolean {
  return !!o && (!!o.error || o.tests.some((t) => !t.passed));
}

/**
 * Runs a request the way the Testing section runs a case: pre-request script, then the request
 * with placeholders filled from environment, CSV row and script variables (in that order of
 * priority, lowest first), then the post-response script. A pre-request script error stops the send.
 * Returns null when Stop cut the request off.
 */
export async function sendWithScripts(input: ScriptedSendInput): Promise<ScriptedSendResult | null> {
  const timeout = input.timeoutMs ?? REQUEST_SCRIPT_TIMEOUT_MS;
  const pre = input.def.preScript ?? "";
  const post = input.def.postScript ?? "";
  let vars: Vars = { ...input.vars };

  let preScript: ScriptOutput | undefined;
  if (pre.trim() !== "") {
    preScript = await input.scripts(pre, scriptContext("pre", input, vars), timeout);
    vars = { ...preScript.vars };
    if (preScript.error) {
      const request = prepareRequest(input.def, { ...input.env, ...input.data, ...vars });
      return {
        outcome: { ok: false, request, error: `Not sent: the pre-request script failed (${preScript.error})`, durationMs: 0, sentAt: new Date().toISOString() },
        sent: false,
        preScript,
        vars,
        scriptFailed: true,
      };
    }
  }

  const prepared = prepareRequest(input.def, { ...input.env, ...input.data, ...vars });
  const outcome = await input.send(prepared, input.signal);
  if (input.signal?.aborted && !outcome.ok) return null;

  let postScript: ScriptOutput | undefined;
  if (outcome.ok && post.trim() !== "") {
    const ctx = scriptContext("post", input, vars);
    ctx.request = { method: prepared.method, url: prepared.url, headers: prepared.headers, body: prepared.body };
    ctx.response = outcome.response;
    postScript = await input.scripts(post, ctx, timeout);
    vars = { ...postScript.vars };
  }

  return { outcome, sent: true, preScript, postScript, vars, scriptFailed: outputFailed(preScript) || outputFailed(postScript) };
}

/** Plain-language notes about what the scripts did, for the run explorer and reports. */
export function scriptNotes(r: { sent?: boolean; preScript?: ScriptOutput; postScript?: ScriptOutput }, hasPostScript: boolean, gotResponse: boolean): string[] {
  const notes: string[] = [];
  if (r.preScript?.error) notes.push(`Pre-request script failed, so the request was not sent: ${r.preScript.error}`);
  if (r.postScript?.error) notes.push(`Post-response script failed: ${r.postScript.error}. Counted as a failure.`);
  const tests = [...(r.preScript?.tests ?? []), ...(r.postScript?.tests ?? [])];
  const failed = tests.filter((t) => !t.passed);
  if (failed.length) notes.push(`${failed.length} of ${tests.length} script tests failed: ${failed.map((t) => t.name).join(", ")}. Counted as a failure.`);
  if (hasPostScript && r.sent !== false && !gotResponse) notes.push("No response, so the post-response script did not run.");
  return notes;
}

/** Shared Worker-backed runner for the Requests section, made on first use. */
let shared: ScriptRunner | null = null;
export function requestScriptRunner(): ScriptRunner {
  shared ??= createWorkerScriptRunner().run;
  return shared;
}
