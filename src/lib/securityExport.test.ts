import { describe, expect, it } from "vitest";
import { DEFAULT_BATCH_OPTIONS } from "./batch";
import { preparedToCurl } from "./curl";
import { newRequest } from "./defaults";
import { buildScript } from "./scriptExport";
import { importSuitesFile } from "./testing/suiteFile";
import { importFlowsFile } from "./flows/flowFile";
import { importWorkspace } from "./workspace";
import type { HttpMethod } from "./types";

describe("security of generated commands", () => {
  for (const newline of ["\r", "\n", "\r\n"]) {
    it(`keeps metadata inside comments for ${JSON.stringify(newline)}`, () => {
      for (const lang of ["python", "bash"] as const) {
        const script = buildScript(lang, { def: { ...newRequest(), name: `name${newline}INJECTED`, url: "https://example.test" }, options: DEFAULT_BATCH_OPTIONS, defaults: { a: "b" }, envName: `env${newline}INJECTED` });
        expect(script.split("# Needs")[0]).not.toMatch(/^[^#\r\n]*INJECTED/m);
      }
    });
  }
  it("rejects malformed methods at direct generation and import boundaries", () => {
    const method = "POST & echo INJECTED" as HttpMethod;
    for (const shell of ["bash", "cmd"] as const) expect(preparedToCurl({ method, url: "https://example.test", headers: [] }, shell).command).toBe("");
    const text = JSON.stringify({ app: "rest-runner", kind: "test-suites", suites: [{ id: "s", cases: [{ id: "c", request: { ...newRequest(), method } }] }] });
    expect(() => importSuitesFile(text, [])).toThrow(/method/i);
    const node = { kind: "request", id: "r", request: { ...newRequest(), method }, examples: [] };
    expect(() => importFlowsFile(JSON.stringify({ app: "rest-runner", kind: "flows", requests: [{ node }] }), { flows: [], suites: [], collections: [] })).toThrow(/method/i);
    expect(() => importWorkspace(JSON.stringify({ app: "rest-runner", collections: [{ id: "c", items: [node] }] }), { flows: [], suites: [], collections: [], environments: [], tools: [] })).toThrow(/method/i);
    for (const lang of ["python", "bash"] as const) expect(() => buildScript(lang, { def: { ...newRequest(), method }, options: DEFAULT_BATCH_OPTIONS, defaults: {} })).toThrow(/method/i);
  });
  it("refuses cmd arguments with line breaks", () => {
    for (const req of [
      { method: "POST" as const, url: "https://example.test\necho BAD", headers: [] },
      { method: "POST" as const, url: "https://example.test", headers: [["X", "a\rb"]] as [string, string][] },
      { method: "POST" as const, url: "https://example.test", headers: [], body: "a\nb" },
    ]) expect(preparedToCurl(req, "cmd").command).toBe("");
    const cert = { stem: "bad\necho BAD", client: { name: "x", client: { format: "pem", separateKey: true, hasPassphrase: false } }, ca: null };
    expect(preparedToCurl({ method: "GET", url: "https://example.test", headers: [] }, "cmd", false, cert as never).command).toBe("");
    for (const value of ["a%b", "a!b"]) expect(preparedToCurl({ method: "GET", url: value, headers: [] }, "cmd").command).toBe("");
  });
});
