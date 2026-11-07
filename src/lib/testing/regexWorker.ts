// Isolated so pathological backtracking can be terminated by the caller.
self.onmessage = (event: MessageEvent<{ pattern: string; input: string }>) => {
  try { self.postMessage({ result: new RegExp(event.data.pattern).test(event.data.input) }); }
  catch { self.postMessage({ invalid: true }); }
};
