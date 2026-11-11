import { describe, expect, it } from "vitest";
import { newRequest } from "../defaults";
import { newBlock, newCall, newTool } from "./tools";
import type { CallResult, ToolBlock, ToolCall } from "./types";
import {
  callView,
  canRetry,
  environmentNames,
  fieldRows,
  formatFieldValue,
  inputsSummary,
  jsonText,
  lookupAsText,
  numberView,
  parseColourMap,
  progressCounts,
  requestLine,
  runsOnEnter,
  statusBadgeView,
  statusLabel,
  statusTone,
  tableView,
} from "./view";

function done(callId: string, body: unknown, status = 200, extra: Partial<CallResult> = {}): CallResult {
  const text = JSON.stringify(body);
  return { callId, name: callId, state: "done", status, durationMs: 120, response: { status, statusText: "", headers: [], body: text, sizeBytes: text.length, durationMs: 120 }, ...extra };
}

const call: ToolCall = { ...newCall("r1", "Subscriber"), id: "c1" };

function block(type: ToolBlock["type"], extra: Partial<ToolBlock> = {}): ToolBlock {
  return newBlock(type, 0, { callId: "c1", ...extra });
}

describe("formatFieldValue", () => {
  it("shows a dash for nothing", () => {
    expect(formatFieldValue(undefined, "text")).toBe("—");
    expect(formatFieldValue(null, "number")).toBe("—");
    expect(formatFieldValue("", "date")).toBe("—");
  });
  it("formats text, objects and booleans plainly", () => {
    expect(formatFieldValue("abc", "text")).toBe("abc");
    expect(formatFieldValue(7, "text")).toBe("7");
    expect(formatFieldValue({ a: 1 }, "text")).toBe('{"a":1}');
  });
  it("formats numbers and money with grouping", () => {
    expect(formatFieldValue(1234.5, "number")).toBe((1234.5).toLocaleString(undefined, { maximumFractionDigits: 6 }));
    expect(formatFieldValue("1234.5", "money")).toBe((1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(formatFieldValue(3, "money")).toMatch(/3[.,]00$/);
  });
  it("leaves a non-number as it is", () => {
    expect(formatFieldValue("n/a", "number")).toBe("n/a");
    expect(formatFieldValue("soon", "money")).toBe("soon");
  });
  it("formats dates, with the time only when there is one", () => {
    const dateOnly = formatFieldValue("2021-03-14", "date");
    expect(dateOnly).toContain("2021");
    expect(dateOnly).not.toMatch(/\d:\d\d/);
    expect(formatFieldValue("2021-03-14T10:30:00Z", "date")).toMatch(/\d:\d\d/);
    expect(formatFieldValue("yesterday", "date")).toBe("yesterday");
    expect(formatFieldValue(1_700_000_000, "date")).toContain("2023");
  });
  it("formats yes and no", () => {
    expect(formatFieldValue(true, "yes-no")).toBe("Yes");
    expect(formatFieldValue(false, "yes-no")).toBe("No");
    expect(formatFieldValue("Y", "yes-no")).toBe("Yes");
    expect(formatFieldValue("false", "yes-no")).toBe("No");
    expect(formatFieldValue(1, "yes-no")).toBe("Yes");
    expect(formatFieldValue("maybe", "yes-no")).toBe("maybe");
  });
});

describe("requestLine", () => {
  const def = (url: string, method: "GET" | "POST" = "GET") => ({ ...newRequest(), url, method });
  it("keeps the method and the path with its placeholders", () => {
    expect(requestLine(def("https://api.example.com/subscribers/{{subscriberId}}"))).toEqual({ method: "GET", path: "/subscribers/{{subscriberId}}" });
  });
  it("drops a base address kept in a variable", () => {
    expect(requestLine(def("{{baseUrl}}/accounts/{{accountId}}/usage", "POST"))).toEqual({ method: "POST", path: "/accounts/{{accountId}}/usage" });
  });
  it("handles a bare host and a missing request", () => {
    expect(requestLine(def("https://example.com"))?.path).toBe("/");
    expect(requestLine(null)).toBeNull();
  });
});

describe("callView", () => {
  const view = (result: CallResult | undefined, sending = false, lookingUp = false) => callView({ result, sending, lookingUp });
  it("tells idle, waiting and running apart before a result", () => {
    expect(view(undefined).kind).toBe("idle");
    expect(view(undefined, false, true).kind).toBe("waiting");
    expect(view(undefined, true, true).kind).toBe("running");
  });
  it("is ok for 2xx and 3xx, http-error for 4xx and 5xx", () => {
    expect(view(done("c1", {}, 200))).toMatchObject({ kind: "ok", status: 200 });
    expect(view(done("c1", {}, 302)).kind).toBe("ok");
    expect(view(done("c1", {}, 404))).toMatchObject({ kind: "http-error", status: 404 });
    expect(view(done("c1", {}, 503)).kind).toBe("http-error");
  });
  it("shows skipped messages, missing requests, network errors and stops", () => {
    expect(view({ callId: "c1", name: "x", state: "skipped", reason: "needs-value", message: "Needs accountId from Subscriber" })).toEqual({ kind: "skipped", message: "Needs accountId from Subscriber", missingRequest: false });
    expect(view({ callId: "c1", name: "x", state: "skipped", reason: "missing-request", message: "Request missing" })).toMatchObject({ missingRequest: true });
    expect(view({ callId: "c1", name: "x", state: "network-error", error: "connection refused" })).toEqual({ kind: "network-error", message: "connection refused" });
    expect(view({ callId: "c1", name: "x", state: "stopped" }).kind).toBe("stopped");
  });
  it("labels, colours and offers Retry only for failures worth retrying", () => {
    const ok = view(done("c1", {}, 200));
    const bad = view(done("c1", {}, 500));
    expect(statusLabel(ok)).toBe("200 · 120 ms");
    expect(statusTone(ok)).toBe("ok");
    expect(statusTone(bad)).toBe("bad");
    expect(canRetry(bad)).toBe(true);
    expect(canRetry(view({ callId: "c1", name: "x", state: "network-error", error: "x" }))).toBe(true);
    expect(canRetry(ok)).toBe(false);
    expect(canRetry(view({ callId: "c1", name: "x", state: "skipped", message: "m" }))).toBe(false);
    expect(statusLabel(view(undefined, true, true))).toBe("Running");
    expect(statusLabel(view({ callId: "c1", name: "x", state: "stopped" }))).toBe("Stopped");
    expect(statusLabel(view({ callId: "c1", name: "x", state: "skipped", reason: "missing-request" }))).toBe("Request missing");
  });
});

describe("block views", () => {
  const body = { name: "Ada", balance: 40, active: true, account: { id: "A-77" }, status: "suspended", items: [{ n: "INV-1", amt: 40 }, { n: "INV-2", amt: 5.5 }] };
  const result = done("c1", body);

  it("fields: label and formatted value per field", () => {
    const b = block("fields", { fields: [{ path: "$.name", label: "Name", format: "text" }, { path: "$.active", label: "Active", format: "yes-no" }, { path: "$.missing", label: "Gone", format: "text" }] });
    expect(fieldRows(b, call, result)).toEqual([
      { label: "Name", value: "Ada" },
      { label: "Active", value: "Yes" },
      { label: "Gone", value: "—" },
    ]);
  });

  it("table: one row per list item, columns from the picked fields", () => {
    const b = block("table", { fields: [{ path: "$.n", label: "Invoice", format: "text" }, { path: "$.amt", label: "Amount", format: "money" }] });
    const t = tableView(b, call, result);
    expect(t.columns).toEqual(["Invoice", "Amount"]);
    expect(t.rows.map((r) => r[0])).toEqual(["INV-1", "INV-2"]);
    expect(t.rows[1][1]).toMatch(/5[.,]50$/);
    expect(t.pickedIndex).toBeNull();
  });

  it("table: reads a response that is the list, and a pick-a-row list path", () => {
    const b = block("table", { fields: [{ path: "$.id", label: "Id", format: "text" }] });
    expect(tableView(b, call, done("c1", [{ id: 1 }, { id: 2 }, { id: 3 }])).rows).toHaveLength(3);
    const pick: ToolCall = { ...call, pickRow: { listPath: "$.devices", labelPath: "" } };
    const r = done("c1", { devices: [{ id: "a" }, { id: "b" }] }, 200, { picked: { index: 1 } });
    const t = tableView(b, pick, r);
    expect(t.rows).toEqual([["a"], ["b"]]);
    expect(t.pickedIndex).toBe(1);
  });

  it("fields read the picked row of a pick-a-row call", () => {
    const pick: ToolCall = { ...call, pickRow: { listPath: "$.devices", labelPath: "" } };
    const r = done("c1", { devices: [{ id: "a" }, { id: "b" }] }, 200, { picked: { index: 1 } });
    expect(fieldRows(block("fields", { fields: [{ path: "$.id", label: "Id", format: "text" }] }), pick, r)[0].value).toBe("b");
  });

  it("number: the big value and its unit", () => {
    const b = block("number", { fields: [{ path: "$.balance", label: "Balance", format: "money" }], text: " USD " });
    const n = numberView(b, call, result);
    expect(n.value).toMatch(/40[.,]00$/);
    expect(n.unit).toBe("USD");
    expect(numberView(block("number"), call, result).value).toBe("—");
  });

  it("status: maps the value to a colour, ignoring case, and defaults to grey", () => {
    const b = block("status", { fields: [{ path: "$.status", label: "S", format: "text" }], text: "Active = green\nsuspended = red\nbogus = purple" });
    expect(statusBadgeView(b, call, result)).toEqual({ text: "suspended", colour: "red" });
    expect(statusBadgeView(b, call, done("c1", { status: "ACTIVE" }))).toEqual({ text: "ACTIVE", colour: "green" });
    expect(statusBadgeView(b, call, done("c1", { status: "other" })).colour).toBe("grey");
    expect(parseColourMap("a = blue\nnonsense\n= red")).toEqual({ a: "blue" });
  });

  it("json: the whole response pretty-printed, or one path", () => {
    expect(jsonText(block("json"), call, result)).toBe(JSON.stringify(body, null, 2));
    expect(jsonText(block("json", { fields: [{ path: "$.account", label: "", format: "text" }] }), call, result)).toBe(JSON.stringify({ id: "A-77" }, null, 2));
    expect(jsonText(block("json", { fields: [{ path: "$.nope", label: "", format: "text" }] }), call, result)).toBe("");
  });
});

describe("the whole lookup", () => {
  const tool = newTool("Sub");
  tool.calls = [{ ...call }, { ...newCall("r2", "Account"), id: "c2" }, { ...newCall("r3", "Suspend", "POST"), id: "c3" }];

  it("counts done and running calls, leaving write calls out", () => {
    expect(progressCounts(tool, { c1: done("c1", {}) }, ["c2"])).toEqual({ done: 1, running: 1, total: 2 });
    expect(progressCounts(tool, {}, [])).toEqual({ done: 0, running: 0, total: 2 });
  });

  it("copies everything as text", () => {
    const findRequest = (id: string) => (id === "r1" ? { ...newRequest(), url: "https://x.test/subscribers/{{id}}" } : null);
    const text = lookupAsText(tool, { c1: done("c1", { a: 1 }), c2: { callId: "c2", name: "Account", state: "skipped", message: "Needs accountId from Subscriber" } }, findRequest);
    expect(text).toContain("Sub");
    expect(text).toContain("Subscriber (GET /subscribers/{{id}}) · 200 · 120 ms");
    expect(text).toContain('"a": 1');
    expect(text).toContain("Account · Skipped\nNeeds accountId from Subscriber");
  });

  it("summarises inputs and names the environment variables the tool still needs", () => {
    expect(inputsSummary({ a: "1", b: "", c: "x" })).toBe("a: 1 · c: x");
    const t = newTool("T");
    t.calls = [{ ...newCall("r1", "A"), id: "a", mappings: { id: { input: "id" } } }];
    const find = () => ({ ...newRequest(), url: "{{baseUrl}}/s/{{id}}" });
    expect(environmentNames(t, find)).toEqual(["baseUrl"]);
  });
});

describe("runsOnEnter", () => {
  it("runs on a plain Enter", () => {
    expect(runsOnEnter({ key: "Enter" })).toBe(true);
  });
  it("does not run on other keys, with Shift or Alt, or while composing text", () => {
    expect(runsOnEnter({ key: "a" })).toBe(false);
    expect(runsOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(runsOnEnter({ key: "Enter", altKey: true })).toBe(false);
    expect(runsOnEnter({ key: "Enter", isComposing: true })).toBe(false);
  });
});
