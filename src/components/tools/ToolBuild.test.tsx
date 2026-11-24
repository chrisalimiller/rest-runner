import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addFoundList, findLists, pickMappingPath } from "../../lib/tools/listBuilder";
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
const actions: BoardActions = { onInput: noop, onRunKey: noop, onRetry: noop, onOpenRequest: noop, onCopy: noop, onPick: noop, onRunAction: noop };

function done(callId: string, body: unknown): CallResult {
  const text = JSON.stringify(body);
  return { callId, name: callId, state: "done", status: 200, durationMs: 5, response: { status: 200, statusText: "OK", headers: [], body: text, sizeBytes: text.length, durationMs: 5 } };
}

function stateOf(results: CallResult[] = [], extra: Partial<SessionState> = {}): SessionState {
  return { inputs: {}, results: Object.fromEntries(results.map((r) => [r.callId, r])), sending: [], writes: {}, writing: [], running: false, startedAt: null, viewing: null, recordId: null, pending: [], error: null, stopped: false, loaded: true, ...extra };
}

const subscriber = done("c-subscriber", { name: "Ada", autoPay: true, account: { id: "A-77", planId: "P-5" } });

describe("Calls column", () => {
  const html = renderToStaticMarkup(<CallsColumn tool={sampleTool()} findRequest={find} results={{}} onChange={noop} onEditInputs={noop} onFillIn={noop} onOpenRequest={noop} />);

  it("always labels the picker button Add request", () => {
    expect(html).toContain("Add request");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("Close");
  });

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
    expect(html).toContain("call-chip-kind");
    expect(html).not.toContain("from-input");
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

describe("Lists in the Calls column", () => {
  const customer = { devices: [{ model: "Pixel 9", imei: "3501", services: [{ id: "s1" }] }, { model: "iPad", imei: "3502", services: [] }], plans: [{ id: "p1" }] };
  const render = (t: ReturnType<typeof sampleTool>, results: Record<string, CallResult> = {}) =>
    renderToStaticMarkup(<CallsColumn tool={t} findRequest={find} results={results} onChange={noop} onEditInputs={noop} onFillIn={noop} onOpenRequest={noop} />);
  const withList = () => addFoundList(sampleTool(), "c-devices", findLists(customer)[0]).tool;

  it("shows a call's list with its size, rule menu and the text that names an item", () => {
    const out = render(withList(), { "c-devices": done("c-devices", customer) });
    expect(out).toContain("Lists in Devices");
    expect(out).toContain('value="Devices"');
    expect(out).toContain("2 items");
    for (const label of ["Show only", "Ask me to pick", "First", "Last", "Row number", "First where…"]) expect(out).toContain(label);
    expect(out).toContain("Shown when choosing");
    expect(out).toContain('value="$.model"');
  });

  it("offers the lists found in the sample that are not added yet, including inside an item", () => {
    const out = render(withList(), { "c-devices": done("c-devices", customer) });
    expect(out).toContain("Found in the sample");
    expect(out).toContain("+ Plans (1)");
    expect(out).toContain("Inside each devices item");
    expect(out).toContain("+ Services");
  });

  it("says when a list is not in the sample, and tells how to find lists before a sample run", () => {
    const out = render(withList());
    expect(out).toContain("not in sample");
    expect(render(sampleTool())).toContain("Run with sample to find the lists in the response.");
  });

  it("keeps the old pick-a-row checkbox off for a call with lists, and shows Use lists instead only for a pick-a-row call", () => {
    const lists = render(withList());
    expect(lists).not.toContain("Use lists instead");
    expect(lists).toMatch(/<input type="checkbox" disabled=""[^>]*\/><span>Ask me to pick a row/);
    const t = sampleTool();
    t.calls = t.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "$.devices", labelPath: "$.model" } } : c));
    const legacy = render(t);
    expect(legacy).toContain("Use lists instead");
    expect(legacy).not.toContain("Lists in Devices");
  });

  it("warns when an ask list has no table to pick in, and offers one", () => {
    const t = addFoundList(sampleTool(), "c-devices", findLists(customer)[0], undefined, { kind: "ask" }).tool;
    expect(render(t)).toContain("Add a table for Devices");
    const shown = { ...t, blocks: [...t.blocks, { id: "b-new", type: "table" as const, title: "", fields: [], row: 9, callId: "c-devices", listId: t.calls.find((c) => c.id === "c-devices")!.lists![0].id }] };
    expect(render(shown)).not.toContain("Add a table for Devices");
  });

  it("shows what a value reads through a list in Needs, and a removed list in red", () => {
    const t = pickMappingPath(withList(), "c-account", "accountId", "c-devices", customer, "$.devices[0].imei");
    expect(render(t)).toContain("Devices › Devices › Show only › imei".replace("Show only", "row you pick"));
    const gone = { ...t, calls: t.calls.map((c) => (c.id === "c-devices" ? { ...c, lists: [] } : c)) };
    const out = render(gone);
    expect(out).toContain("a removed list");
    expect(out).toContain("call-chip-missing");
  });
});

describe("Connect dialog with lists", () => {
  const customer = { devices: [{ model: "Pixel 9", imei: "3501" }, { model: "iPad", imei: "3502" }] };
  const readsList = () => {
    const t = pickMappingPath(sampleTool(), "c-account", "accountId", "c-devices", customer, "$.devices[0].imei");
    return t;
  };

  it("asks which item a value reads, with the breadcrumb and what the sample gives", () => {
    const t = readsList();
    const listId = t.calls.find((c) => c.id === "c-devices")!.lists![0].id;
    const state = stateOf([done("c-devices", customer, )]);
    state.results["c-devices"] = { ...state.results["c-devices"], picks: { [listId]: { index: 1, key: "iPad" } } };
    const html = renderToStaticMarkup(<ConnectDialog tool={t} target={{ callId: "c-account" }} findRequest={find} state={state} onRunSample={noop} onStop={noop} onCancel={noop} onDone={noop} />);
    expect(html).toContain("Which devices?");
    expect(html).toContain("Same as the list (row you pick)");
    for (const label of ["The row I pick", "First", "Last", "Row number", "First where…", "All, joined", "How many"]) expect(html).toContain(label);
    expect(html.replace(/<[^>]+>/g, "")).toContain("Devices › Devices › row you pick › imei");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Sample: 3502");
    expect(html).toContain("3502");
    expect(html).toContain('value="$.imei"');
  });

  it("explains why a value cannot be read yet", () => {
    const t = readsList();
    const html = renderToStaticMarkup(<ConnectDialog tool={t} target={{ callId: "c-account" }} findRequest={find} state={stateOf([done("c-devices", customer)])} onRunSample={noop} onStop={noop} onCancel={noop} onDone={noop} />);
    expect(html).toContain("No row picked in Devices");
  });

  it("says a list was removed instead of showing a choice", () => {
    const t = readsList();
    const gone = { ...t, calls: t.calls.map((c) => (c.id === "c-devices" ? { ...c, lists: [] } : c)) };
    const html = renderToStaticMarkup(<ConnectDialog tool={gone} target={{ callId: "c-account" }} findRequest={find} state={stateOf([done("c-devices", customer)])} onRunSample={noop} onStop={noop} onCancel={noop} onDone={noop} />);
    expect(html).toContain("This list was removed");
    expect(html.replace(/<[^>]+>/g, "")).toContain("a removed list");
  });
});

describe("block page", () => {
  const render = (selectedId: string | null = null, t = sampleTool()) =>
    renderToStaticMarkup(<BlockPage tool={t} state={stateOf([subscriber])} findRequest={find} actions={actions} selectedId={selectedId} onSelect={noop} onConnect={noop} onBlocks={noop} onAdd={noop} onDuplicate={noop} onDelete={noop} />);

  it("renders each block with a handle, connect and a ⋯ menu for the rest", () => {
    const html = render();
    expect(html).toContain('draggable="true"');
    expect(html).toContain("Connect Subscriber");
    expect(html).toContain("More actions: Subscriber");
    // Moves, duplicate and delete sit in the closed menu, not on the block.
    expect(html).not.toContain("Move left: Subscriber");
    expect(html).not.toContain("Duplicate Subscriber");
    expect(html).not.toContain("Delete Subscriber");
    // A real answer is in the preview.
    expect(html).toContain("<dd>Ada</dd>");
  });

  it("puts blocks of one row side by side", () => {
    const html = render();
    expect(html).toContain("repeat(2, minmax(0, 1fr))");
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
    for (const s of ["Request", "Values", "Fields", "Labels"]) expect(html).toContain(s);
  });

  it("shows Done only on the last step, with Next before it", () => {
    const html = dialog("b-subscriber");
    expect(html).toContain("Next");
    expect(html).not.toMatch(/>Done</);
    expect(html).not.toContain('class="send"');
    const note = dialog("b-note");
    expect(note).toMatch(/>Done</);
    expect(note).not.toContain("Next");
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
  const props = { findRequest: find, environments: [], onChange: noop, onSave: noop, onDiscard: noop, onRunSample: noop, onStop: noop, actions: { onInput: noop, onOpenRequest: noop, onCopy: noop, onPick: noop, onRetry: noop, onRunAction: noop } };

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
