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
