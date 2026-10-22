/// <reference lib="webworker" />
import { executeScript, type ScriptContext } from "./sandbox";

self.onmessage = (e: MessageEvent<{ id: number; code: string; ctx: ScriptContext }>) => {
  const { id, code, ctx } = e.data;
  const output = executeScript(code, ctx);
  (self as DedicatedWorkerGlobalScope).postMessage({ id, output });
};
