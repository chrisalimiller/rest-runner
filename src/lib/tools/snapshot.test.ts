import { describe, expect, it } from "vitest";
import { sampleFindRequest, sampleTool } from "./sample";
import { snapshotFileName, toToolSnapshot } from "./snapshot";
import { newBlock } from "./tools";
import type { CallResult, Tool } from "./types";

function done(callId: string, body: unknown, status = 200): CallResult {
  const text = JSON.stringify(body);
  return { callId, name: callId, state: "done", status, durationMs: 50, response: { status, statusText: "", headers: [], body: text, sizeBytes: text.length, durationMs: 50 } };
}

function tool(): Tool {
  const t = sampleTool();
  t.name = "Sub <script>alert(1)</script>";
  t.blocks = [
    newBlock("input", 0, { inputName: "subscriberId", title: "Look up" }),
    newBlock("fields", 1, { callId: "c-subscriber", title: "Who", fields: [{ path: "name", label: "Name", format: "text" }] }),
    newBlock("table", 1, { callId: "c-invoices", title: "Invoices", fields: [{ path: "number", label: "No.", format: "text" }] }),
    newBlock("action", 2, { callId: "c-suspend", title: "Suspend" }),
  ];
  return t;
}

const results = {
  "c-subscriber": done("c-subscriber", { name: "<img src=x onerror=alert(1)>" }),
  "c-invoices": { callId: "c-invoices", name: "Invoices", state: "network-error", error: "connect failed token=hunter2hunter2" } as CallResult,
};

describe("toToolSnapshot", () => {
  const html = toToolSnapshot({ tool: tool(), results, inputs: { subscriberId: "100234" }, findRequest: sampleFindRequest(), environmentName: "Prod", at: "2026-01-02T03:04:05Z", secrets: ["hunter2hunter2"] });

  it("is a whole page with the answers in it", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("100234");
    expect(html).toContain("Prod");
    expect(html).toContain("Who");
  });
  it("escapes everything that came from a tool or a server", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("masks secrets like history does", () => {
    expect(html).not.toContain("hunter2hunter2");
  });
  it("leaves action buttons out (they do nothing on a page) and shows a failed call as a problem", () => {
    expect(html).not.toContain("Suspend");
    expect(html).toContain("No response");
    expect(html).toContain('class="bad"');
  });
});

describe("snapshotFileName", () => {
  it("is safe and names the lookup", () => {
    expect(snapshotFileName({ name: "Sub/360" }, { id: "100234" })).toBe("Sub 360 100234.html");
    expect(snapshotFileName({ name: "" }, {})).toBe("tool.html");
  });
});

describe("toToolSnapshot: tables on lists", () => {
  it("marks the picked row in each list's table", () => {
    const t = sampleTool();
    const call = {
      ...t.calls.find((c) => c.id === "c-devices")!,
      lists: [
        { id: "devices", name: "Devices", path: "$.devices", labelPath: "$.model", choose: { kind: "ask" as const } },
        { id: "services", name: "Services", path: "$.services", labelPath: "$.name", choose: { kind: "ask" as const } },
      ],
    };
    t.calls = t.calls.map((c) => (c.id === "c-devices" ? call : c));
    t.blocks = [
      newBlock("table", 0, { callId: "c-devices", listId: "devices", title: "Devices", fields: [{ path: "$.model", label: "Model", format: "text" }] }),
      newBlock("table", 0, { callId: "c-devices", listId: "services", title: "Services", fields: [{ path: "$.name", label: "Name", format: "text" }] }),
    ];
    const r = { ...done("c-devices", { devices: [{ model: "A" }, { model: "B" }], services: [{ name: "X" }, { name: "Y" }, { name: "Z" }] }), picks: { devices: { index: 1, key: "B" }, services: { index: 2, key: "Z" } } };
    const html = toToolSnapshot({ tool: t, results: { "c-devices": r }, inputs: {}, findRequest: sampleFindRequest() });
    expect(html).toContain('<tr class="picked"><td>B</td></tr>');
    expect(html).toContain('<tr class="picked"><td>Z</td></tr>');
    expect(html.match(/class="picked"/g)).toHaveLength(2);
  });
});

describe("toToolSnapshot: expandable rows", () => {
  it("writes a closed details element for a row with more to show, and leaves other tables alone", () => {
    const t = sampleTool();
    t.calls = t.calls.map((c) => (c.id === "c-devices" ? { ...c, lists: [{ id: "devices", name: "Devices", path: "$.devices", labelPath: "$.model", choose: { kind: "none" as const } }] } : c));
    t.blocks = [newBlock("table", 0, { callId: "c-devices", listId: "devices", title: "Devices", expandable: true, fields: [{ path: "$.model", label: "Model", format: "text" }] })];
    const r = done("c-devices", { devices: [{ model: "<A>", colour: "red", features: [{ name: "5G" }] }, { model: "B" }] });
    const html = toToolSnapshot({ tool: t, results: { "c-devices": r }, inputs: {}, findRequest: sampleFindRequest() });
    expect(html).toContain("<details><summary>&lt;A&gt;</summary>");
    expect(html).toContain("<dt>colour</dt><dd>red</dd>");
    expect(html).toContain("<th>name</th>");
    expect(html).not.toContain("<details open");
    expect(html.match(/<details>/g)).toHaveLength(1);
    t.blocks[0].expandable = false;
    expect(toToolSnapshot({ tool: t, results: { "c-devices": r }, inputs: {}, findRequest: sampleFindRequest() })).not.toContain("<details");
  });
});

describe("toToolSnapshot with a list shown as rows", () => {
  it("keeps every row, not only the first few shown on screen", () => {
    const t = tool();
    t.blocks = [newBlock("fields", 0, { callId: "c-subscriber", title: "Who", fields: [{ path: "$.items", label: "Items", format: "text" }] })];
    const items = Array.from({ length: 8 }, (_, i) => ({ n: `item-${i}`, v: i }));
    const html = toToolSnapshot({ tool: t, results: { "c-subscriber": done("c-subscriber", { items }) }, inputs: {}, findRequest: sampleFindRequest(), at: "2026-01-02T03:04:05Z", secrets: [] });
    expect(html).toContain("<th>n</th>");
    expect(html).toContain("item-7");
  });
});
