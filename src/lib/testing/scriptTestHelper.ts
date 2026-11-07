import { executeScript } from "./sandbox";
import type { ScriptRunner } from "./scriptRunner";
export const inlineScriptRunner: ScriptRunner = (code, ctx, timeoutMs) => executeScript(code, ctx, timeoutMs);
