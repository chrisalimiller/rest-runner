import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleFindRequest, sampleTool } from "../../lib/tools/sample";
import type { SessionState } from "../../lib/tools/session";
import type { CallResult } from "../../lib/tools/types";
import { BlockCard, ToolBoard, blockRows, type BoardActions } from "./ToolBlocks";
import { InputControl } from "./InputControl";

const tool = sampleTool();
const findRequest = sampleFindRequest();
const actions: BoardActions = { onInput: () => {}, onRunKey: () => {}, onRetry: () => {}, onOpenRequest: () => {}, onCopy: () => {}, onPick: () => {} };

function done(callId: string, body: unknown, status = 200): CallResult {
  const text = JSON.stringify(body);
  return { callId, name: callId, state: "done", status, durationMs: 80, response: { status, statusText: status === 200 ? "OK" : "Bad", headers: [], body: text, sizeBytes: text.length, durationMs: 80 } };
}

function stateOf(results: CallResult[], extra: Partial<SessionState> = {}): SessionState {
  return { inputs: {}, results: Object.fromEntries(results.map((r) => [r.callId, r])), sending: [], running: false, startedAt: null, viewing: null, recordId: null, pending: [], error: null, stopped: false, loaded: true, ...extra };
}

function card(blockId: string, state: SessionState, t = tool): string {
  const block = t.blocks.find((b) => b.id === blockId)!;
  return renderToStaticMarkup(<BlockCard block={block} tool={t} state={state} findRequest={findRequest} actions={actions} />);
}

const subscriber = done("c-subscriber", { name: "Ada Lovelace", joined: "2021-03-14", autoPay: true, account: { id: "A-77", planId: "P-5" } });

describe("block types", () => {
  it("fields: label and value pairs, with the request line and status in the header", () => {
    const html = card("b-subscriber", stateOf([subscriber]));
    expect(html).toContain("Subscriber");
    expect(html).toContain("<dt>Name</dt><dd>Ada Lovelace</dd>");
    expect(html).toContain("<dt>Auto-pay</dt><dd>Yes</dd>");
    expect(html).toContain("m-get");
    expect(html).toContain("/subscribers/{{subscriberId}}");
    expect(html).toContain("200 · 80 ms");
    expect(html).toContain('data-state="ok"');
  });

  it("table: a row per list item", () => {
    const html = card("b-invoices", stateOf([done("c-invoices", { invoices: [{ number: "INV-1", amount: 40, paid: true }, { number: "INV-2", amount: 40, paid: false }] })]));
    expect(html).toContain("<th scope=\"col\">Invoice</th>");
    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(html).toContain("INV-2");
    expect(html).toContain("<td>No</td>");
  });

  it("number: the big number with its unit", () => {
    const html = card("b-balance", stateOf([done("c-account", { status: "active", balance: 1250 })]));
    expect(html).toContain("tool-number-value");
    expect(html).toContain(">USD<");
    expect(html).toMatch(/1[.,\s ]?250[.,]00/);
  });

  it("status: a badge in the mapped colour", () => {
    expect(card("b-status", stateOf([done("c-account", { status: "suspended" })]))).toContain("badge-red");
    expect(card("b-status", stateOf([done("c-account", { status: "active" })]))).toContain("badge-green");
    expect(card("b-status", stateOf([done("c-account", { status: "weird" })]))).toContain("badge-grey");
  });

  it("json: read-only and foldable, whole response", () => {
    const html = card("b-json", stateOf([subscriber]));
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
    expect(html).toContain("&quot;name&quot;: &quot;Ada Lovelace&quot;");
  });

  it("note: typed text, no request line", () => {
    const html = card("b-note", stateOf([]));
    expect(html).toContain("Tip");
    expect(html).toContain("The account number comes from the subscriber record.");
    expect(html).not.toContain("tool-block-status");
  });

  it("action: a disabled button for now", () => {
    const html = card("b-suspend", stateOf([]));
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Suspend");
  });

  it("input: the input's box with its default as the hint", () => {
    const html = card("b-input", stateOf([], { inputs: { subscriberId: "42" } }));
    expect(html).toContain('value="42"');
    expect(html).toContain('placeholder="100234"');
    expect(html).toContain("Subscriber ID");
  });
});

describe("block states", () => {
  it("before a lookup the block says to look up", () => {
    const html = card("b-subscriber", stateOf([]));
    expect(html).toContain("Look up to fill this in.");
  });

  it("waiting and running show a loading placeholder", () => {
    const waiting = card("b-balance", stateOf([], { running: true }));
    expect(waiting).toContain("tool-skeleton");
    expect(waiting).toContain('data-state="waiting"');
    const running = card("b-balance", stateOf([], { running: true, sending: ["c-account"] }));
    expect(running).toContain('data-state="running"');
    expect(running).toContain(">Running<");
  });

  it("a fast call shows while a slow one is still loading", () => {
    const html = renderToStaticMarkup(<ToolBoard tool={tool} state={stateOf([subscriber], { running: true, sending: ["c-devices", "c-account"] })} findRequest={findRequest} actions={actions} />);
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('data-block="table" data-state="running"');
  });

  it("a 4xx or 5xx shows the status and body in red with Retry, and Open request", () => {
    const html = card("b-subscriber", stateOf([done("c-subscriber", { error: "no such subscriber" }, 404)]));
    expect(html).toContain('data-state="http-error"');
    expect(html).toContain("tone-bad");
    expect(html).toContain("<strong>404</strong>");
    expect(html).toContain("no such subscriber");
    expect(html).toContain(">Retry<");
    expect(html).toContain(">Open request<");
    expect(html).not.toContain("Ada");
  });

  it("a skipped call shows the engine's message", () => {
    const html = card("b-balance", stateOf([{ callId: "c-account", name: "Account", state: "skipped", reason: "needs-value", message: "Needs accountId from Subscriber" }]));
    expect(html).toContain("Needs accountId from Subscriber");
    expect(html).toContain(">Skipped<");
    expect(html).not.toContain(">Retry<");
  });

  it("a deleted request shows Request missing", () => {
    const html = renderToStaticMarkup(
      <BlockCard block={tool.blocks.find((b) => b.id === "b-balance")!} tool={tool} state={stateOf([{ callId: "c-account", name: "Account", state: "skipped", reason: "missing-request", message: "Request missing" }])} findRequest={() => null} actions={actions} />,
    );
    expect(html).toContain("Request missing");
    expect(html).not.toContain("tool-block-request");
  });

  it("a network error shows the text and Retry", () => {
    const html = card("b-subscriber", stateOf([{ callId: "c-subscriber", name: "Subscriber", state: "network-error", error: "connection refused" }]));
    expect(html).toContain("connection refused");
    expect(html).toContain(">Retry<");
    expect(html).toContain(">No response<");
  });

  it("stopped shows nothing new", () => {
    const html = card("b-subscriber", stateOf([{ callId: "c-subscriber", name: "Subscriber", state: "stopped" }]));
    expect(html).toContain("Stopped");
    expect(html).not.toContain(">Retry<");
    expect(html).not.toContain("<dl");
  });

  it("a pick-a-row table offers each row while the lookup waits for the choice", () => {
    const t = { ...tool, calls: tool.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "$.devices", labelPath: "$.model" } } : c)) };
    const result = done("c-devices", { devices: [{ model: "Pixel 9", imei: "1" }, { model: "iPad", imei: "2" }] });
    const waiting = card("b-devices", stateOf([result], { running: true, pending: [{ callId: "c-devices", rows: [{}, {}] }] }), t);
    expect(waiting.match(/Use this row/g)).toHaveLength(2);
    expect(waiting).toContain("Pick a row");
    const chosen = card("b-devices", stateOf([{ ...result, picked: { index: 1 } }]), t);
    expect(chosen).not.toContain("Use this row");
    expect(chosen).toContain('class="picked"');
    expect(chosen).toContain("Used");
  });
});

describe("the board", () => {
  it("groups blocks into rows in order, up to three to a row", () => {
    const rows = blockRows(tool.blocks);
    expect(rows.map((r) => r.length)).toEqual([1, 3, 2, 2, 1, 2]);
    expect(rows.every((r) => r.length <= 3)).toBe(true);
  });

  it("draws every block of the example tool", () => {
    const html = renderToStaticMarkup(<ToolBoard tool={tool} state={stateOf([])} findRequest={findRequest} actions={actions} />);
    expect(html.match(/<section/g)).toHaveLength(tool.blocks.length);
  });
});

describe("InputControl", () => {
  it("renders a dropdown with its choices", () => {
    const html = renderToStaticMarkup(<InputControl input={{ name: "region", label: "Region", kind: "dropdown", options: ["EU", "US"], default: "US" }} value="" onChange={() => {}} onEnter={() => {}} />);
    expect(html).toContain("<select");
    expect(html).toContain("<option value=\"EU\"");
    expect(html).toContain("selected");
  });
});
