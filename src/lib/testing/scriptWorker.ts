/// <reference lib="webworker" />
import { executeScript, type ScriptContext } from "./sandbox";

self.onmessage = async (e: MessageEvent<{ id: number; code: string; ctx: ScriptContext; timeoutMs: number }>) => {
  const { id, code, ctx, timeoutMs } = e.data;
  const output = await executeScript(code, ctx, timeoutMs);
  (self as DedicatedWorkerGlobalScope).postMessage({ id, output });
};
