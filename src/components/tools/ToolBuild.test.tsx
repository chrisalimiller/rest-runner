import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleFindRequest, sampleTool } from "../../lib/tools/sample";
import type { SessionState } from "../../lib/tools/session";
import type { CallResult } from "../../lib/tools/types";
import { BlockPage } from "./BlockPage";
import { CallsColumn } from "./CallsColumn";
import { ConnectDialog, stepsFor } from "./ConnectDialog";
import { JsonTree } from "./JsonTree";
import { ToolBuild } from "./ToolBuild";
import type { BoardActions } from "./ToolBlocks";
import { ToolSettingsDialog } from "./ToolSettingsDialog";
import { UnsavedDialog } from "./UnsavedDialog";

const find = sampleFindRequest();
const noop = () => {};
const actions: BoardActions = { onInput: noop, onRunKey: noop, onRetry: noop, onOpenRequest: noop, onCopy: noop, onPick: noop };

function done(callId: string, body: unknown): CallResult {
  const text = JSON.stringify(body);
  return { callId, name: callId, state: "done", status: 200, durationMs: 5, response: { status: 200, statusText: "OK", headers: [], body: text, sizeBytes: text.length, durationMs: 5 } };
}

function stateOf(results: CallResult[] = [], extra: Partial<SessionState> = {}): SessionState {
  return { inputs: {}, results: Object.fromEntries(results.map((r) => [r.callId, r])), sending: [], running: false, startedAt: null, viewing: null, recordId: null, pending: [], error: null, stopped: false, loaded: true, ...extra };
}

const subscriber = done("c-subscriber", { name: "Ada", autoPay: true, account: { id: "A-77", planId: "P-5" } });

describe("Calls column", () => {
  const html = renderToStaticMarkup(<CallsColumn tool={sampleTool()} findRequest={find} results={{}} onChange={noop} onEditInputs={noop} onFillIn={noop} onOpenRequest={noop} />);

  it("lists Input, then Step 1 and Step 2, in that order", () => {
    const at = (s: string) => html.indexOf(`aria-label="${s}"`);
    expect(at("Input")).toBeGreaterThan(-1);
    expect(at("Step 1")).toBeGreaterThan(at("Input"));
    expect(at("Step 2")).toBeGreaterThan(at("Step 1"));
    expect(html).not.toContain("Step 3");
  });

  it("shows what a call needs and gives", () => {
    expect(html).toContain("accountId");
    expect(html).toContain("Subscriber › account.id");
    expect(html).toContain("Subscriber ID");
    expect(html).toContain("call-chip give");
  });

  it("marks write calls", () => {
    expect(html).toContain("Runs only from an Action button");
  });

  it("says Request missing for a deleted request", () => {
    const t = sampleTool();
    t.calls[1] = { ...t.calls[1], requestId: "deleted" };
    const out = renderToStaticMarkup(<CallsColumn tool={t} findRequest={find} results={{}} onChange={noop} onEditInputs={noop} onFillIn={noop} onOpenRequest={noop} />);
    expect(out).toContain("Request missing");
  });

  it("shows a loop as an error and not as steps", () => {
    const t = sampleTool();
    t.calls[0] = { ...t.calls[0], mappings: { subscriberId: { call: { callId: "c-account", path: "$.id" } } } };
    const out = renderToStaticMarkup(<CallsColumn tool={t} findRequest={find} results={{}} onChange={noop} onEditInputs={noop} onFillIn={noop} onOpenRequest={noop} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("wait on each other");
    expect(out).not.toContain("Step 1");
    expect(out).toContain("in-loop");
  });

  it("shows pick-a-row settings when on", () => {
    const t = sampleTool();
    t.calls = t.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "$.devices", labelPath: "$.model" } } : c));
    const out = renderToStaticMarkup(<CallsColumn tool={t} findRequest={find} results={{}} onChange={noop} onEditInputs={noop} onFillIn={noop} onOpenRequest={noop} />);
    expect(out).toContain("$.devices");
    expect(out).toContain("Shown when choosing");
  });
});

describe("block page", () => {
  const render = (selectedId: string | null = null, t = sampleTool()) =>
    renderToStaticMarkup(<BlockPage tool={t} state={stateOf([subscriber])} findRequest={find} actions={actions} selectedId={selectedId} onSelect={noop} onConnect={noop} onBlocks={noop} onAdd={noop} onDuplicate={noop} onDelete={noop} />);

  it("renders each block with a handle, move buttons, connect, duplicate and delete", () => {
    const html = render();
    expect(html).toContain('draggable="true"');
    expect(html).toContain("Move left: Subscriber");
    expect(html).toContain("Move down: Subscriber");
    expect(html).toContain("Connect Subscriber");
    expect(html).toContain("Duplicate Subscriber");
    expect(html).toContain("Delete Subscriber");
    // A real answer is in the preview.
    expect(html).toContain("<dd>Ada</dd>");
  });

  it("puts blocks of one row side by side", () => {
    const html = render();
    expect(html).toContain("repeat(2, minmax(0, 1fr))");
  });

  it("disables moves that cannot happen", () => {
    const html = render();
    const first = html.slice(html.indexOf("Move left: Look up"), html.indexOf("Move left: Look up") + 120);
    expect(first).toContain("disabled");
  });

  it("marks the selected block", () => {
    expect(render("b-subscriber")).toContain("build-block selected");
    expect(render()).not.toContain("build-block selected");
  });

  it("offers the slash menu and Add block", () => {
    const html = render();
    expect(html).toContain("Type / to add a block");
    expect(html).toContain("Add block");
  });

  it("is empty-friendly", () => {
    const t = sampleTool();
    t.blocks = [];
    expect(render(null, t)).toContain("This page is empty");
  });
});

describe("Connect dialog", () => {
  const tool = sampleTool();
  const dialog = (blockId: string, results: CallResult[] = [], t = tool) =>
    renderToStaticMarkup(<ConnectDialog tool={t} target={{ blockId }} findRequest={find} state={stateOf(results)} onRunSample={noop} onStop={noop} onCancel={noop} onDone={noop} />);

  it("has the four steps for a data block", () => {
    expect(stepsFor(tool.blocks.find((b) => b.id === "b-subscriber"))).toEqual(["request", "fill", "fields", "format"]);
    expect(stepsFor(tool.blocks.find((b) => b.id === "b-note"))).toEqual(["note"]);
    expect(stepsFor(tool.blocks.find((b) => b.id === "b-input"))).toEqual(["input"]);
    expect(stepsFor(tool.blocks.find((b) => b.id === "b-suspend"))).toEqual(["request", "fill", "format"]);
    expect(stepsFor(undefined)).toEqual(["fill"]);
    const html = dialog("b-subscriber");
    for (const s of ["Request", "Fill in", "Fields", "Format"]) expect(html).toContain(s);
  });

  it("step 1 lists the tool's calls with the chosen one checked", () => {
    const html = dialog("b-subscriber");
    expect(html).toContain("Which request fills this block?");
    expect(html).toMatch(/checked=""[^>]*\/><span class="cd-call-name">Subscriber/);
    expect(html).toContain("Add another saved request");
  });
});

describe("tree and settings", () => {
  it("the sample tree shows paths to click", () => {
    const html = renderToStaticMarkup(<JsonTree sample={{ name: "Ada", account: { id: "A-77" }, items: [1, 2, 3, 4, 5] }} isPicked={(p) => p === "$.name"} onPick={noop} label="Sample" />);
    expect(html).toContain('data-path="$.name"');
    expect(html).toContain('data-path="$.account.id"');
    expect(html).toContain('data-path="$.items[0]"');
    expect(html).not.toContain('data-path="$.items[3]"');
    expect(html).toContain("2 more like these");
    expect(html).toContain("json-line picked");
  });

  it("the settings dialog shows inputs and lookup settings", () => {
    const html = renderToStaticMarkup(<ToolSettingsDialog tool={sampleTool()} environments={[{ id: "e1", name: "Staging", variables: [] } as never]} onChange={noop} onClose={noop} />);
    expect(html).toContain("Subscriber ID");
    expect(html).toContain("Add input");
    expect(html).toContain("Look up when the tool is opened");
    expect(html).toContain("Staging");
  });

  it("the unsaved dialog offers Save, Discard and Keep editing, and explains why Save is not possible", () => {
    const html = renderToStaticMarkup(<UnsavedDialog toolName="T" onSave={noop} onDiscard={noop} onCancel={noop} />);
    expect(html).toContain("Keep editing");
    expect(html).toContain("Discard");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Save/);
    const blocked = renderToStaticMarkup(<UnsavedDialog toolName="T" blocked="A needs its own result." onSave={noop} onDiscard={noop} onCancel={noop} />);
    expect(blocked).toContain("A needs its own result.");
    expect(blocked).toMatch(/disabled=""[^>]*>Save/);
  });
});

describe("Build page", () => {
  const props = { findRequest: find, environments: [], onChange: noop, onSave: noop, onDiscard: noop, onRunSample: noop, onStop: noop, actions: { onInput: noop, onOpenRequest: noop, onCopy: noop, onPick: noop } };

  it("clean tool: Save and Discard are off", () => {
    const html = renderToStaticMarkup(<ToolBuild tool={sampleTool()} dirty={false} state={stateOf()} {...props} />);
    expect(html).toMatch(/disabled=""[^>]*>Discard/);
    expect(html).toMatch(/disabled=""[^>]*title="Nothing to save">Save/);
    expect(html).toContain("Run with sample");
    expect(html).not.toContain("Unsaved changes");
  });

  it("dirty tool: says so and offers Save", () => {
    const html = renderToStaticMarkup(<ToolBuild tool={sampleTool()} dirty state={stateOf()} {...props} />);
    expect(html).toContain("Unsaved changes");
    expect(html).not.toMatch(/disabled=""[^>]*>Discard/);
  });

  it("a loop blocks Save and Run with sample, and says why", () => {
    const t = sampleTool();
    t.calls[0] = { ...t.calls[0], mappings: { subscriberId: { call: { callId: "c-account", path: "$.id" } } } };
    const html = renderToStaticMarkup(<ToolBuild tool={t} dirty state={stateOf()} {...props} />);
    expect(html).toContain("build-problems");
    expect(html).toContain("cannot be saved until that is fixed");
    expect(html).toMatch(/disabled=""[^>]*>Save/);
    expect(html).toMatch(/disabled=""[^>]*>Run with sample/);
  });

  it("running with sample shows Stop, and a pick-a-row wait", () => {
    const html = renderToStaticMarkup(<ToolBuild tool={sampleTool()} dirty={false} state={stateOf([], { running: true, pending: [{ callId: "c-devices", rows: [] }] })} {...props} />);
    expect(html).toContain(">Stop<");
    expect(html).toContain("pick a row in the table");
  });

  it("sample inputs not shown in an input block appear above the page", () => {
    const t = sampleTool();
    t.blocks = t.blocks.filter((b) => b.type !== "input");
    expect(renderToStaticMarkup(<ToolBuild tool={t} dirty={false} state={stateOf()} {...props} />)).toContain("Subscriber ID");
  });
});
