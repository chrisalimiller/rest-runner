import { beforeEach, describe, expect, it } from "vitest";
import { newRequest } from "../defaults";
import type { RequestDef } from "../types";
import { cleanTools, defaultIsWrite, hasToolErrors, loadTools, newBlock, newCall, newInput, newTool, saveTools, TOOLS_KEY, validateTool } from "./tools";
import type { Tool } from "./types";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});

function req(id: string, url = "https://x/{{id}}"): RequestDef {
  return { ...newRequest(), id, url };
}
const find = (...defs: RequestDef[]) => (id: string) => defs.find((d) => d.id === id) ?? null;

function sampleTool(): Tool {
  const tool = newTool("Subscriber lookup");
  tool.description = "Find a subscriber";
  tool.inputs = [{ ...newInput("subscriberId"), label: "Subscriber ID", default: "42" }, { ...newInput("region", "dropdown"), options: ["EU", "US"] }];
  const a = { ...newCall("r1", "Subscriber", "GET"), mappings: { id: { input: "subscriberId" } }, pickRow: { listPath: "$.items", labelPath: "name" } };
  const b = { ...newCall("r2", "Account", "GET"), mappings: { id: { call: { callId: a.id, path: "accountId" }, fixed: "0" } } };
  const w = newCall("r3", "Suspend", "POST");
  tool.calls = [a, b, w];
  tool.blocks = [
    newBlock("fields", 0, { title: "Subscriber", callId: a.id, fields: [{ path: "name", label: "Name", format: "text" }] }),
    newBlock("action", 0, { title: "Suspend", callId: w.id }),
    newBlock("note", 1, { text: "Careful" }),
  ];
  tool.settings = { environmentId: "env1", runOnOpen: true, keepHistory: false };
  return tool;
}

describe("persistence", () => {
  it("round-trips a tool through localStorage", () => {
    const tool = sampleTool();
    expect(saveTools([tool])).toBe(true);
    expect(localStorage.getItem(TOOLS_KEY)).not.toBeNull();
    expect(loadTools()).toEqual([tool]);
  });

  it("loads nothing when nothing, broken JSON or the wrong shape is stored", () => {
    expect(loadTools()).toEqual([]);
    localStorage.setItem(TOOLS_KEY, "{bad");
    expect(loadTools()).toEqual([]);
    localStorage.setItem(TOOLS_KEY, JSON.stringify({ not: "a list" }));
    expect(loadTools()).toEqual([]);
  });

  it("starts a new tool keeping history, not running on open", () => {
    const t = newTool();
    expect(t.settings).toEqual({ environmentId: null, runOnOpen: false, keepHistory: true });
  });
});

describe("cleanTools", () => {
  it("fills in what an older or hand-edited tool lacks", () => {
    const [t] = cleanTools([{ id: "t1" }]);
    expect(t).toEqual({ id: "t1", name: "Tool", description: "", inputs: [], calls: [], blocks: [], settings: { environmentId: null, runOnOpen: false, keepHistory: true } });
  });

  it("drops entries that cannot be used and keeps ids unique", () => {
    const tools = cleanTools([null, 3, { name: "no id" }, { id: "a" }, { id: "a", name: "dup" }]);
    expect(tools.map((t) => t.id)).toEqual(["a"]);
    expect(cleanTools("nope")).toEqual([]);
  });

  it("cleans inputs, calls and blocks", () => {
    const [t] = cleanTools([
      {
        id: "t",
        inputs: [{ name: "a", kind: "weird" }, { name: "b", kind: "dropdown", options: ["x", 5] }, { kind: "text" }, "no"],
        calls: [
          { id: "c1", requestId: "r", write: "yes", mappings: { p: { input: "a" }, q: {}, r: "bad", s: { call: { callId: "", path: "x" } } } },
          { id: "c1" },
          { name: "no id" },
        ],
        blocks: [
          { id: "b1", type: "table", row: -4.5, fields: [{ path: "a", format: "nope" }, null] },
          { id: "b2", type: "unknown" },
          { id: "b3", type: "number" },
        ],
        settings: { keepHistory: "no", environmentId: 7 },
      },
    ]);
    expect(t.inputs).toEqual([
      { name: "a", label: "a", kind: "text" },
      { name: "b", label: "b", kind: "dropdown", options: ["x"] },
    ]);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toEqual({ id: "c1", name: "Call", requestId: "r", write: false, mappings: { p: { input: "a" } } });
    expect(t.blocks.map((b) => b.id)).toEqual(["b1", "b3"]);
    expect(t.blocks[0].row).toBe(0);
    expect(t.blocks[0].fields).toEqual([{ path: "a", label: "", format: "text" }]);
    expect(t.blocks[1].row).toBe(2);
    expect(t.settings).toEqual({ environmentId: null, runOnOpen: false, keepHistory: true });
  });
});

describe("defaultIsWrite", () => {
  it("flags POST, PUT, PATCH and DELETE as write calls", () => {
    expect(["GET", "HEAD", "OPTIONS"].map((m) => defaultIsWrite(m as never))).toEqual([false, false, false]);
    expect(["POST", "PUT", "PATCH", "DELETE"].map((m) => defaultIsWrite(m as never))).toEqual([true, true, true, true]);
    expect(newCall("r", "x", "DELETE").write).toBe(true);
    expect(newCall("r", "x", "GET").write).toBe(false);
  });
});

describe("validateTool", () => {
  it("accepts a sound tool", () => {
    const tool = sampleTool();
    expect(validateTool(tool, find(req("r1"), req("r2"), req("r3")))).toEqual([]);
  });

  it("reports a loop as an error", () => {
    const tool = sampleTool();
    tool.calls[0].mappings.id = { call: { callId: tool.calls[1].id, path: "x" } };
    const problems = validateTool(tool, find(req("r1"), req("r2"), req("r3")));
    expect(problems.find((p) => p.code === "cycle")?.level).toBe("error");
    expect(hasToolErrors(problems)).toBe(true);
  });

  it("warns about a missing request, removed call or input, and crowded rows", () => {
    const tool = sampleTool();
    tool.calls[1].mappings.id = { call: { callId: "gone", path: "x" }, input: "nope" };
    tool.blocks.push(newBlock("note", 0), newBlock("note", 0), newBlock("json", 1, { callId: "gone" }));
    const problems = validateTool(tool, find(req("r1"), req("r3")));
    const codes = problems.map((p) => p.code).sort();
    expect(codes).toEqual(["missing-request", "too-many-in-row", "unknown-block-call", "unknown-call", "unknown-input"]);
    expect(hasToolErrors(problems)).toBe(false);
  });

  it("errors on two inputs with the same name", () => {
    const tool = sampleTool();
    tool.inputs.push(newInput("subscriberId"));
    expect(hasToolErrors(validateTool(tool, find(req("r1"), req("r2"), req("r3"))))).toBe(true);
  });
});
