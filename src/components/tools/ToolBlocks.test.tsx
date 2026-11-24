import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleFindRequest, sampleTool } from "../../lib/tools/sample";
import type { SessionState } from "../../lib/tools/session";
import type { CallResult, Tool, ToolList } from "../../lib/tools/types";
import { BlockCard, ToolBoard, blockRows, headerStatus, nextRowIndex, pickBlocking, pickWaitingFor, type BoardActions } from "./ToolBlocks";
import { InputControl } from "./InputControl";

const tool = sampleTool();
const findRequest = sampleFindRequest();
const actions: BoardActions = { onInput: () => {}, onRunKey: () => {}, onRetry: () => {}, onOpenRequest: () => {}, onCopy: () => {}, onPick: () => {}, onRunAction: () => {} };

function done(callId: string, body: unknown, status = 200): CallResult {
  const text = JSON.stringify(body);
  return { callId, name: callId, state: "done", status, durationMs: 80, response: { status, statusText: status === 200 ? "OK" : "Bad", headers: [], body: text, sizeBytes: text.length, durationMs: 80 } };
}

function stateOf(results: CallResult[], extra: Partial<SessionState> = {}): SessionState {
  return { inputs: {}, results: Object.fromEntries(results.map((r) => [r.callId, r])), sending: [], writes: {}, writing: [], running: false, startedAt: null, viewing: null, recordId: null, pending: [], error: null, stopped: false, loaded: true, ...extra };
}

function card(blockId: string, state: SessionState, t = tool, a: Partial<BoardActions> = {}): string {
  const block = t.blocks.find((b) => b.id === blockId)!;
  return renderToStaticMarkup(<BlockCard block={block} tool={t} state={state} findRequest={findRequest} actions={{ ...actions, ...a }} />);
}

const subscriber = done("c-subscriber", { name: "Ada Lovelace", joined: "2021-03-14", autoPay: true, account: { id: "A-77", planId: "P-5" } });

describe("block types", () => {
  it("fields: label and value pairs, with only the time in the header and no request line", () => {
    const html = card("b-subscriber", stateOf([subscriber]));
    expect(html).toContain("Subscriber");
    expect(html).toContain("<dt>Name</dt><dd>Ada Lovelace</dd>");
    expect(html).toContain("<dt>Auto-pay</dt><dd>Yes</dd>");
    expect(html).not.toContain("m-get");
    expect(html).not.toContain("tool-block-request");
    expect(html).toContain("tone-faint");
    expect(html).toContain(">80 ms<");
    expect(html).not.toContain("200 · 80 ms");
    // The request stays reachable: it is the tooltip of the status.
    expect(html).toContain('title="GET /subscribers/{{subscriberId}}"');
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

  it("action: an enabled button before it is pressed", () => {
    const html = card("b-suspend", stateOf([]));
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Suspend");
  });

  const cardWith = (state: SessionState, a: Partial<BoardActions> = {}) =>
    renderToStaticMarkup(<BlockCard block={tool.blocks.find((b) => b.id === "b-suspend")!} tool={tool} state={state} findRequest={findRequest} actions={{ ...actions, ...a }} />);

  it("action: shows what the write call got back, including an error body", () => {
    const ok = cardWith(stateOf([], { writes: { "c-suspend": done("c-suspend", { suspended: true }, 201) } }));
    expect(ok).toContain("201");
    expect(ok).toContain("suspended");
    const bad = cardWith(stateOf([], { writes: { "c-suspend": done("c-suspend", { error: "no" }, 409) } }));
    expect(bad).toContain("tone-bad");
    expect(bad).toContain("409");
    const net = cardWith(stateOf([], { writes: { "c-suspend": { callId: "c-suspend", name: "Suspend", state: "network-error", error: "connection refused" } } }));
    expect(net).toContain("connection refused");
  });

  it("action: a declined confirm reads Not confirmed, a missing value reads its message", () => {
    const no = cardWith(stateOf([], { writes: { "c-suspend": { callId: "c-suspend", name: "Suspend", state: "skipped", reason: "not-confirmed", message: "Not sent: Prod needs confirming first." } } }));
    expect(no).toContain("Not confirmed");
    const need = cardWith(stateOf([], { writes: { "c-suspend": { callId: "c-suspend", name: "Suspend", state: "skipped", reason: "needs-value", message: "Needs id from Subscriber" } } }));
    expect(need).toContain("Needs id from Subscriber");
  });

  it("action: says which production environment it asks about, and is off while sending or looking up", () => {
    const guarded = cardWith(stateOf([]), { guard: { name: "Prod", cssColor: "var(--env-red)" } });
    expect(guarded).toContain("on Prod");
    expect(guarded).toContain("guarded");
    expect(cardWith(stateOf([], { writing: ["c-suspend"] }))).toMatch(/<button[^>]*disabled=""[^>]*>Sending…/);
    expect(cardWith(stateOf([], { running: true }))).toMatch(/<button[^>]*disabled=""/);
  });

  it("action: a lookup call cannot be run from a button", () => {
    const t = { ...tool, blocks: tool.blocks.map((b) => (b.id === "b-suspend" ? { ...b, callId: "c-subscriber" } : b)) };
    const html = renderToStaticMarkup(<BlockCard block={t.blocks.find((b) => b.id === "b-suspend")!} tool={t} state={stateOf([])} findRequest={findRequest} actions={actions} />);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("runs with Look up");
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
    expect(html).not.toContain("Look up to fill this in");
    expect(html).toContain("tool-idle");
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
    const html = card("b-subscriber", stateOf([done("c-subscriber", { error: "no such subscriber" }, 404)]), tool, { retryAlone: () => true });
    expect(html).toContain('data-state="http-error"');
    expect(html).toContain("tone-bad");
    expect(html).toContain("<strong>404</strong>");
    expect(html).toContain("no such subscriber");
    expect(html).toContain(">Retry<");
    expect(html).toContain(">Open request<");
    expect(html).not.toContain("Ada");
    expect(html).toContain("404 · 80 ms");
  });

  it("Retry says what it reruns: Retry for one call, Run lookup again when dependants need the whole lookup", () => {
    const state = stateOf([{ callId: "c-subscriber", name: "Subscriber", state: "network-error", error: "connection refused" }]);
    expect(card("b-subscriber", state, tool, { retryAlone: () => true })).toContain(">Retry<");
    const whole = card("b-subscriber", state, tool, { retryAlone: () => false });
    expect(whole).toContain(">Run lookup again<");
    expect(whole).not.toContain(">Retry<");
  });

  it("header status: 2xx shows only the time, everything else says its status", () => {
    expect(headerStatus({ kind: "ok", status: 200, ms: 80 })).toMatchObject({ text: "80 ms", tone: "faint", loud: false });
    expect(headerStatus({ kind: "http-error", status: 500, ms: 80 })).toMatchObject({ text: "500 · 80 ms", tone: "bad", loud: true });
    expect(headerStatus({ kind: "ok", status: 304, ms: 80 })?.text).toBe("304 · 80 ms");
    expect(headerStatus({ kind: "idle" })).toBeNull();
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
    expect(html).not.toContain("Choose another request");
  });

  it("a missing request offers Choose another request when the page can switch to Build", () => {
    const state = stateOf([{ callId: "c-account", name: "Account", state: "skipped", reason: "missing-request", message: "Request missing" }]);
    const html = renderToStaticMarkup(<BlockCard block={tool.blocks.find((b) => b.id === "b-balance")!} tool={tool} state={state} findRequest={() => null} actions={{ ...actions, onChooseRequest: () => {} }} />);
    expect(html).toContain(">Choose another request<");
  });

  it("a network error shows the text and Retry", () => {
    const html = card("b-subscriber", stateOf([{ callId: "c-subscriber", name: "Subscriber", state: "network-error", error: "connection refused" }]), tool, { retryAlone: () => true });
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

  const pickTool = { ...tool, calls: tool.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "$.devices", labelPath: "$.model" } } : c)) };
  const devices = done("c-devices", { devices: [{ model: "Pixel 9", imei: "1" }, { model: "iPad", imei: "2" }] });

  it("a pick-a-row table is a radio group while the lookup waits for the choice, with no per-row link", () => {
    const waiting = card("b-devices", stateOf([devices], { running: true, pending: [{ callId: "c-devices", rows: [{}, {}] }] }), pickTool);
    expect(waiting).not.toContain("Use this row");
    expect(waiting.match(/role="radio"/g)).toHaveLength(2);
    expect(waiting).toContain('role="radiogroup"');
    expect(waiting.match(/tabindex="0"/g)).toHaveLength(1);
    expect(waiting.match(/>Use none</g)).toHaveLength(1);
    expect(waiting).toContain("Pick a row");
  });

  it("after the pick the chosen row is checked, and rows are selectable again only when the page can change the row", () => {
    const state = stateOf([{ ...devices, picked: { index: 1 } }]);
    const readOnly = card("b-devices", state, pickTool);
    expect(readOnly).toContain('class="picked"');
    expect(readOnly).toContain('aria-checked="true"');
    expect(readOnly).not.toContain("Use none");
    expect(readOnly).not.toContain("tabindex");
    const changeable = card("b-devices", state, pickTool, { onChangeRow: () => {} });
    expect(changeable).toContain('tabindex="0"');
    expect(changeable).not.toContain("Use none");
  });

  it("row keys: arrows, Home and End move, other keys do nothing", () => {
    expect(nextRowIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextRowIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextRowIndex("ArrowUp", 0, 3)).toBe(0);
    expect(nextRowIndex("ArrowUp", 2, 3)).toBe(1);
    expect(nextRowIndex("Home", 2, 3)).toBe(0);
    expect(nextRowIndex("End", 0, 3)).toBe(2);
    expect(nextRowIndex("a", 0, 3)).toBeNull();
    expect(nextRowIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("calls that need the pick say they are waiting for a row in the table, with a link to it", () => {
    const t = {
      ...pickTool,
      calls: pickTool.calls.map((c) => (c.id === "c-plan" ? { ...c, mappings: { planId: { call: { callId: "c-devices", path: "$.imei" } } } } : c)),
    };
    const state = stateOf([devices], { running: true, pending: [{ callId: "c-devices", rows: [{}, {}] }] });
    const html = card("b-plan", state, t);
    expect(html).toContain("Waiting for a row in");
    expect(html).toContain(">Go to the table<");
    expect(pickBlocking(t, t.calls.find((c) => c.id === "c-plan")!, state)).toBe("c-devices");
    expect(pickBlocking(t, t.calls.find((c) => c.id === "c-account")!, state)).toBeNull();
  });
});

describe("tables on lists you pick in", () => {
  const listTool = (): Tool => {
    const lists: ToolList[] = [
      { id: "devices", name: "Devices", path: "$.devices", labelPath: "$.model", choose: { kind: "ask" } },
      { id: "services", name: "Services", path: "$.services", labelPath: "$.name", choose: { kind: "ask" } },
    ];
    const cols = [{ path: "$.model", label: "Model", format: "text" as const }];
    return {
      ...tool,
      calls: tool.calls.map((c) =>
        c.id === "c-devices"
          ? { ...c, lists }
          : c.id === "c-plan"
            ? { ...c, mappings: { planId: { call: { callId: "c-devices", path: "$.imei", list: { listId: "devices" } } } } }
            : c.id === "c-usage"
              ? { ...c, mappings: { accountId: { call: { callId: "c-devices", path: "$.id", list: { listId: "services" } } } } }
              : c,
      ),
      blocks: [
        ...tool.blocks.filter((b) => b.id !== "b-devices"),
        { id: "b-devices", type: "table", title: "Devices", callId: "c-devices", listId: "devices", fields: cols, row: 9 },
        { id: "b-services", type: "table", title: "Services", callId: "c-devices", listId: "services", fields: [{ path: "$.name", label: "Name", format: "text" }], row: 9 },
        { id: "b-first", type: "fields", title: "Chosen", callId: "c-devices", fields: [{ path: "$.model", label: "Model", format: "text", list: { listId: "devices" } }], row: 9 },
      ],
    };
  };
  const body = { devices: [{ model: "Pixel 9", imei: "1" }, { model: "iPad", imei: "2" }], services: [{ name: "Mobile", id: "m" }, { name: "TV", id: "t" }, { name: "Net", id: "n" }] };
  const answer = (extra: Partial<CallResult> = {}) => ({ ...done("c-devices", body), ...extra });
  const open = [{ callId: "c-devices", listId: "devices", rows: body.devices }, { callId: "c-devices", listId: "services", rows: body.services }];

  it("each list's table is its own radio group while its pick is open, and says which list it is for", () => {
    const state = stateOf([answer()], { running: true, pending: open });
    const devices = card("b-devices", state, listTool());
    expect(devices).toContain('role="radiogroup"');
    expect(devices).toContain('data-pick-list="devices"');
    expect(devices.match(/role="radio"/g)).toHaveLength(2);
    expect(devices).toContain("Pick a row");
    const services = card("b-services", state, listTool());
    expect(services).toContain('data-pick-list="services"');
    expect(services.match(/role="radio"/g)).toHaveLength(3);
    // Answering one list leaves the other open.
    const half = stateOf([answer({ picks: { devices: { index: 0, key: "Pixel 9" } } })], { running: true, pending: [open[1]] });
    expect(card("b-devices", half, listTool())).not.toContain("Pick a row");
    expect(card("b-devices", half, listTool())).toContain('aria-checked="true"');
    expect(card("b-services", half, listTool())).toContain("Pick a row");
  });

  it("a value that reads the list you have not picked in says it is waiting, and links to that table", () => {
    const state = stateOf([answer()], { running: true, pending: open });
    const html = card("b-first", state, listTool());
    expect(html).toContain("Waiting for a row in Devices");
    expect(html).toContain(">Go to the table<");
  });

  it("calls that read a list wait for that list only, and name it", () => {
    const t = listTool();
    const state = stateOf([answer()], { running: true, pending: [open[1]] });
    // The plan call reads devices (no open pick); the usage call reads services.
    expect(pickWaitingFor(t, t.calls.find((c) => c.id === "c-plan")!, state)).toBeNull();
    expect(pickWaitingFor(t, t.calls.find((c) => c.id === "c-usage")!, state)).toMatchObject({ callId: "c-devices", listId: "services" });
    const html = card("b-usage", stateOf([answer()], { running: true, pending: [open[1]] }), t);
    expect(html).toContain("Waiting for a row in Services");
  });

  it("after the lookup the picked item is checked, and can be changed when the page can change it", () => {
    const state = stateOf([answer({ picks: { devices: { index: 1, key: "iPad" }, services: { index: 0, key: "Mobile" } } })]);
    const readOnly = card("b-devices", state, listTool());
    expect(readOnly).toContain('aria-checked="true"');
    expect(readOnly).not.toContain("tabindex");
    const changeable = card("b-devices", state, listTool(), { onChangeRow: () => {} });
    expect(changeable).toContain('tabindex="0"');
    expect(changeable).not.toContain("Use none");
    // A list nobody picks in is only a table.
    const plain = listTool();
    plain.calls = plain.calls.map((c) => (c.id === "c-devices" ? { ...c, lists: c.lists!.map((l) => ({ ...l, choose: { kind: "none" as const } })) } : c));
    plain.calls = plain.calls.map((c) => (c.id === "c-plan" || c.id === "c-usage" ? { ...c, mappings: {} } : c));
    expect(card("b-devices", state, plain, { onChangeRow: () => {} })).not.toContain("radiogroup");
  });

  it("a list with nothing in it says so", () => {
    const html = card("b-devices", stateOf([done("c-devices", { devices: [], services: [] })]), listTool());
    expect(html).toContain("No devices");
  });

  it("tables of more than 50 rows on a list get a filter box; shorter ones and pick-a-row tables do not", () => {
    const many = { devices: Array.from({ length: 51 }, (_, i) => ({ model: `Phone ${i}`, imei: String(i) })), services: [] };
    const html = card("b-devices", stateOf([done("c-devices", many)]), listTool());
    expect(html).toContain('type="search"');
    expect(html).toContain("Filter Devices rows");
    expect(card("b-devices", stateOf([answer()]), listTool())).not.toContain('type="search"');
    const fifty = { devices: many.devices.slice(0, 50), services: [] };
    expect(card("b-devices", stateOf([done("c-devices", fifty)]), listTool())).not.toContain('type="search"');
    const legacy = { ...tool, calls: tool.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "$.devices", labelPath: "$.model" } } : c)) };
    expect(card("b-devices", stateOf([done("c-devices", many)]), legacy)).not.toContain('type="search"');
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
