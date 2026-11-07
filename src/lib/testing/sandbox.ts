import { getQuickJS } from "quickjs-emscripten";
import guestSource from "./sandboxGuest.js?raw";
import { postmanApiNames, usesPostman } from "../postmanScripts";
import type { Vars } from "../template";
import type { ScriptOutput } from "./types";

export interface ScriptContext {
  phase: "pre" | "post";
  vars: Vars;
  data: Vars;
  env: Vars;
  iteration: number;
  caseName: string;
  request: { method: string; url: string; headers: [string, string][]; body?: string };
  response?: { status: number; statusText: string; headers: [string, string][]; body: string; durationMs: number; sizeBytes: number };
}

/** Executes with a fresh QuickJS heap. Production invokes this only in a terminable worker. */
export async function executeScript(code: string, ctx: ScriptContext, timeoutMs = 1000): Promise<ScriptOutput> {
  const start = Date.now();
  const failure = (error: string): ScriptOutput => ({ tests: [], logs: [], vars: ctx.vars, error, durationMs: Date.now() - start });
  if (usesPostman(code)) {
    const names = postmanApiNames(code, 4);
    const list = names.length ? ` (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})` : "";
    return failure(`This script still uses Postman pm.* calls${list}. Open the Scripts tab to convert them.`);
  }
  try {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    try {
      runtime.setMemoryLimit(16 * 1024 * 1024);
      runtime.setMaxStackSize(512 * 1024);
      runtime.setInterruptHandler(() => Date.now() - start >= timeoutMs);
      const vm = runtime.newContext();
      try {
        const result = vm.evalCode(`${guestSource}\n((stringify, parse) => stringify(executeScript(${JSON.stringify(code)}, parse(${JSON.stringify(JSON.stringify(ctx))}))))(JSON.stringify, JSON.parse)`);
        if (result.error) {
          const e = vm.dump(result.error);
          result.error.dispose();
          return failure(`Script execution failed: ${String(e?.message ?? e)}`);
        }
        const serialized = vm.getString(result.value);
        result.value.dispose();
        if (new TextEncoder().encode(serialized).byteLength > 1024 * 1024) return failure("Script output exceeded the 1 MiB limit");
        const output: unknown = JSON.parse(serialized);
        if (!output || typeof output !== "object") return failure("Script returned invalid output");
        const candidate = output as ScriptOutput;
        if (!Array.isArray(candidate.tests) || !candidate.tests.every(t => t && typeof t.name === "string" && typeof t.passed === "boolean" && (t.error === undefined || typeof t.error === "string")) || !Array.isArray(candidate.logs) || !candidate.logs.every(v => typeof v === "string") || !candidate.vars || typeof candidate.vars !== "object" || Array.isArray(candidate.vars) || !Object.values(candidate.vars).every(v => typeof v === "string") || (candidate.error !== undefined && typeof candidate.error !== "string") || typeof candidate.durationMs !== "number") return failure("Script returned invalid output");
        return candidate;
      } finally { vm.dispose(); }
    } finally { runtime.dispose(); }
  } catch (e) {
    return failure(`Script runtime failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
