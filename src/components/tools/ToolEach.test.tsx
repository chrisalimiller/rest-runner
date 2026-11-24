import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { newRequest } from "../../lib/defaults";
import type { SessionState } from "../../lib/tools/session";
import { newBlock, newCall, newTool } from "../../lib/tools/tools";
import type { CallResult, EachResult, Tool } from "../../lib/tools/types";
import { BlockCard, type BoardActions } from "./ToolBlocks";

const find = (id: string) => ({ ...newRequest(), id, name: id, url: id === "customer" ? "https://api/customer" : "https://api/warranty/{{serial}}" });
const actions: BoardActions = { onInput: () => {}, onRunKey: () => {}, onRetry: () => {}, onOpenRequest: () => {}, onCopy: () => {}, onPick: () => {}, onRunAction: () => {} };

const tool: Tool = {
  ...newTool("T"),
  calls: [
    { ...newCall("customer", "Customer"), id: "c", lists: [{ id: "devices", name: "Devices", path: "$.devices", labelPath: "$.model", choose: { kind: "none" } }] },
    { ...newCall("warranty", "Warranty"), id: "w", mappings: { serial: { call: { callId: "c", path: "$.serial", list: { listId: "devices", item: { kind: "each" } } } } } },
  ],
  blocks: [
    newBlock("table", 0, { id: "t", title: "Devices", callId: "c", listId: "devices", fields: [{ path: "$.model", label: "Model", format: "text" }, { path: "$.expires", label: "Warranty ends", format: "text", callId: "w" }] }),
    newBlock("table", 1, { id: "own", title: "Warranty", callId: "w" }),
  ],
};

const body = JSON.stringify({ devices: [{ serial: "D1", model: "iPhone" }, { serial: "D2", model: "Pixel" }, { serial: "D3", model: "iPad" }] });
const customer: CallResult = { callId: "c", name: "C", state: "done", status: 200, response: { status: 200, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: 4 } };
const ok = (index: number, expires: string): EachResult => ({ index, key: `d${index}`, state: "done", status: 200, durationMs: 5, response: { status: 200, statusText: "", headers: [], body: JSON.stringify({ expires }), sizeBytes: 10, durationMs: 5 } });

function stateOf(w: CallResult | undefined, extra: Partial<SessionState> = {}): SessionState {
  return { inputs: {}, results: { c: customer, ...(w ? { w } : {}) }, sending: [], writes: {}, writing: [], running: false, startedAt: null, viewing: null, recordId: null, pending: [], error: null, stopped: false, loaded: true, ...extra };
}
const card = (id: string, state: SessionState, a: Partial<BoardActions> = {}) => renderToStaticMarkup(<BlockCard block={tool.blocks.find((b) => b.id === id)!} tool={tool} state={state} findRequest={find} actions={{ ...actions, ...a }} />);

describe("a table with a column from a per-item call", () => {
  it("shows each item's value, Running while it is out, and the failed item's status with a Retry", () => {
    const w: CallResult = { callId: "w", name: "W", state: "done", eachTotal: 3, each: [ok(0, "2027-05"), { index: 1, key: "d1", state: "done", status: 503 }, { index: 2, state: "pending" }] };
    const html = card("t", stateOf(w), { onRetryItem: vi.fn() });
    expect(html).toContain("<th scope=\"col\">Warranty ends</th>");
    expect(html).toContain("2027-05");
    expect(html).toContain("HTTP 503");
    expect(html).toContain("Running");
    expect(html).toContain("tool-item-failed");
    expect(html).toContain(">Retry<");
    expect(html.match(/>Retry</g)).toHaveLength(1);
  });

  it("offers no Retry without the action, and says when the item limit was hit", () => {
    const w: CallResult = { callId: "w", name: "W", state: "done", eachTotal: 40, each: [ok(0, "2027-05"), { index: 1, state: "network-error", error: "refused" }, ok(2, "2028-01")] };
    const html = card("t", stateOf(w));
    expect(html).toContain("No response");
    expect(html).not.toContain(">Retry<");
    expect(html).toContain("Ran for the first 3 of 40 devices");
  });

  it("shows Waiting before the per-item call has started", () => {
    expect(card("t", stateOf(undefined, { running: true }))).toContain("Waiting");
  });

  it("the per-item call's own block lists one line per item", () => {
    const w: CallResult = { callId: "w", name: "W", state: "done", eachTotal: 3, each: [ok(0, "2027-05"), { index: 1, key: "Pixel", state: "done", status: 500, durationMs: 3 }, ok(2, "x")] };
    const html = card("own", stateOf(w), { onRetryItem: vi.fn() });
    expect(html).toContain("1 of 3 failed");
    expect(html).toContain("Pixel");
    expect(html).toContain("500 · 3 ms");
    expect(html).toContain(">Retry<");
  });
});
