/** Evaluate JavaScript regular expressions away from the UI thread. */
export function matchRegex(pattern: string, input: string, signal?: AbortSignal): Promise<boolean | string> {
  if (pattern.length > 4096 || input.length > 4 * 1024 * 1024) return Promise.resolve("Regular expression input is too large");
  if (signal?.aborted) return Promise.resolve("Regular expression cancelled");
  return new Promise((resolve) => {
    let worker: Worker;
    try { worker = new Worker(new URL("./regexWorker.ts", import.meta.url), { type: "module" }); }
    catch { resolve("Regular expression worker could not start"); return; }
    let finished = false;
    const finish = (value: boolean | string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(value);
    };
    const cancel = () => finish("Regular expression cancelled");
    const timer = setTimeout(() => finish("Regular expression timed out"), 250);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: boolean; invalid?: boolean }>) => {
      if (typeof event.data?.result === "boolean") finish(event.data.result);
      else if (event.data?.invalid) finish(`"${pattern.slice(0, 100)}" is not a valid regular expression`);
      else finish("Regular expression worker failed");
    };
    worker.onerror = () => finish("Regular expression worker failed");
    worker.onmessageerror = () => finish("Regular expression worker failed");
    try { worker.postMessage({ pattern, input }); } catch { finish("Regular expression worker failed"); }
  });
}
