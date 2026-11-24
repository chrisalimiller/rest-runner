import { describe, expect, it } from "vitest";
import type { SendFn } from "../batch";
import { newRequest } from "../defaults";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import type { PreparedRequest, RequestDef, SendOutcome } from "../types";
import { canRetryAlone, dependentCalls, runLookup, type LookupContext } from "./engine";
import { cleanTools, newBlock, newCall, newTool } from "./tools";
import type { CallResult, Tool } from "./types";
import { fieldRows, jsonText, lookupAsText, numberView, statusBadgeView, tableRows, tableView } from "./view";

/**
 * Tools saved before lists existed. These fixtures were recorded with the engine and views as they were before lists
 * were added; they must keep giving the same answers (upgrade in place). Do not edit an expected value to make a change pass.
 */

const BODIES: Record<string, unknown> = {
  "https://api/customer/C1": {
    name: "Ada",
    status: "active",
    balance: 12.5,
    services: [
      { id: "s1", name: "Mobile", status: "active", plan: { code: "M10" } },
      { id: "s2", name: "Broadband", status: "suspended", plan: { code: "B50" } },
    ],
    devices: [
      { serial: "D-100", model: "iPhone 15", serviceId: "s1" },
      { serial: "D-200", model: "Pixel 8", serviceId: "s2" },
      { serial: "D-300", model: "iPad", serviceId: "s1" },
    ],
  },
  "https://api/devices": [
    { serial: "D-100", model: "iPhone 15" },
    { serial: "D-200", model: "Pixel 8" },
  ],
  "https://api/warranty/D-100": { until: "2027-01-31", covered: true },
  "https://api/warranty/D-200": { until: "2026-02-01", covered: false },
  "https://api/empty": [],
};

function send(): { send: SendFn; urls: string[] } {
  const urls: string[] = [];
  const fn: SendFn = async (req: PreparedRequest) => {
    urls.push(req.url);
    const body = JSON.stringify(BODIES[req.url] ?? {});
    const outcome: SendOutcome = { request: req, sentAt: "2026-01-01T00:00:00.000Z", ok: true, response: { status: 200, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: 1 } };
    return outcome;
  };
  return { send: fn, urls };
}

const requests: Record<string, string> = {
  customer: "https://api/customer/{{customerId}}",
  devices: "https://api/devices",
  empty: "https://api/empty",
  warranty: "https://api/warranty/{{serial}}",
};
const findRequest = (id: string): RequestDef | null => (requests[id] ? { ...newRequest(), id, name: id, url: requests[id] } : null);

function ctx(s: { send: SendFn }, extra: Partial<LookupContext> = {}): LookupContext {
  return { findRequest, envVars: {}, send: s.send, scripts: inlineScriptRunner, ...extra };
}

/** What a run answered, without ids and clocks. */
function plainResults(results: CallResult[]) {
  return results.map((r) => ({ callId: r.callId, state: r.state, status: r.status, message: r.message, reason: r.reason, rowCount: r.rowCount, picked: r.picked, request: r.request, hasPicks: "picks" in r }));
}

function plainCall() {
  const call = { ...newCall("customer", "Customer"), id: "customer", mappings: { customerId: { input: "customerId" } } };
  const blocks = [
    newBlock("fields", 0, { id: "b1", callId: "customer", fields: [{ path: "$.name", label: "Name", format: "text" }, { path: "$.balance", label: "Balance", format: "money" }] }),
    newBlock("number", 0, { id: "b2", callId: "customer", fields: [{ path: "$.balance", label: "", format: "money" }], text: "EUR" }),
    newBlock("status", 0, { id: "b3", callId: "customer", fields: [{ path: "$.status", label: "", format: "text" }], text: "active = green" }),
    newBlock("json", 1, { id: "b4", callId: "customer", fields: [{ path: "$.plan", label: "", format: "text" }] }),
    // No list chosen: the first list in the response.
    newBlock("table", 1, { id: "b5", callId: "customer", fields: [{ path: "$.id", label: "Id", format: "text" }, { path: "$.name", label: "Name", format: "text" }] }),
  ];
  return { ...newTool("Plain"), id: "plain", inputs: [{ name: "customerId", label: "Customer", kind: "text" as const }], calls: [call], blocks };
}

function pickTool(): Tool {
  const devices = { ...newCall("devices", "Devices"), id: "devices", pickRow: { listPath: "$", labelPath: "$.model" } };
  const warranty = { ...newCall("warranty", "Warranty"), id: "warranty", mappings: { serial: { call: { callId: "devices", path: "$.serial" } } } };
  const blocks = [
    newBlock("table", 0, { id: "t1", callId: "devices", fields: [{ path: "$.model", label: "Model", format: "text" }] }),
    newBlock("fields", 0, { id: "f1", callId: "devices", fields: [{ path: "$.serial", label: "Serial", format: "text" }] }),
    newBlock("json", 1, { id: "j1", callId: "devices", fields: [] }),
    newBlock("fields", 1, { id: "f2", callId: "warranty", fields: [{ path: "$.until", label: "Until", format: "date" }, { path: "$.covered", label: "Covered", format: "yes-no" }] }),
  ];
  return { ...newTool("Pick"), id: "pick", calls: [devices, warranty], blocks };
}

function twoListsTool(): Tool {
  const call = { ...newCall("customer", "Customer"), id: "customer", mappings: { customerId: { fixed: "C1" } } };
  const blocks = [newBlock("table", 0, { id: "t1", callId: "customer", fields: [{ path: "$.name", label: "Service", format: "text" }, { path: "$.status", label: "Status", format: "text" }] })];
  return { ...newTool("Two lists"), id: "two", calls: [call], blocks };
}

describe("tools saved before lists", () => {
  it("a plain call and its blocks", async () => {
    const tool = plainTool();
    const s = send();
    const run = await runLookup(tool, { customerId: "C1" }, ctx(s));
    const result = run.results[0];
    expect(s.urls).toEqual(["https://api/customer/C1"]);
    expect(plainResults(run.results)).toMatchInlineSnapshot(`
      [
        {
          "callId": "customer",
          "hasPicks": false,
          "message": undefined,
          "picked": undefined,
          "reason": undefined,
          "request": {
            "method": "GET",
            "url": "https://api/customer/C1",
          },
          "rowCount": undefined,
          "state": "done",
          "status": 200,
        },
      ]
    `);
    const call = tool.calls[0];
    expect({
      fields: fieldRows(tool.blocks[0], call, result),
      number: numberView(tool.blocks[1], call, result),
      status: statusBadgeView(tool.blocks[2], call, result),
      json: jsonText(tool.blocks[3], call, result),
      table: tableView(tool.blocks[4], call, result),
      rows: tableRows(call, result),
      all: lookupAsText(tool, { customer: result }, findRequest).length,
    }).toMatchInlineSnapshot(`
      {
        "all": 682,
        "fields": [
          {
            "label": "Name",
            "value": "Ada",
          },
          {
            "label": "Balance",
            "value": "12.50",
          },
        ],
        "json": "",
        "number": {
          "unit": "EUR",
          "value": "12.50",
        },
        "rows": [
          {
            "id": "s1",
            "name": "Mobile",
            "plan": {
              "code": "M10",
            },
            "status": "active",
          },
          {
            "id": "s2",
            "name": "Broadband",
            "plan": {
              "code": "B50",
            },
            "status": "suspended",
          },
        ],
        "status": {
          "colour": "green",
          "text": "active",
        },
        "table": {
          "columns": [
            "Id",
            "Name",
          ],
          "pickedIndex": null,
          "rows": [
            [
              "s1",
              "Mobile",
            ],
            [
              "s2",
              "Broadband",
            ],
          ],
        },
      }
    `);
  });

  it("a pick-a-row call with a dependent call", async () => {
    const tool = pickTool();
    const s = send();
    const asked: unknown[] = [];
    const run = await runLookup(tool, {}, ctx(s, { pickRow: async ({ rows }) => (asked.push(rows.length), 1) }));
    expect(asked).toEqual([2]);
    expect(s.urls).toEqual(["https://api/devices", "https://api/warranty/D-200"]);
    expect(plainResults(run.results)).toMatchInlineSnapshot(`
      [
        {
          "callId": "devices",
          "hasPicks": false,
          "message": undefined,
          "picked": {
            "index": 1,
          },
          "reason": undefined,
          "request": {
            "method": "GET",
            "url": "https://api/devices",
          },
          "rowCount": 2,
          "state": "done",
          "status": 200,
        },
        {
          "callId": "warranty",
          "hasPicks": false,
          "message": undefined,
          "picked": undefined,
          "reason": undefined,
          "request": {
            "method": "GET",
            "url": "https://api/warranty/D-200",
          },
          "rowCount": undefined,
          "state": "done",
          "status": 200,
        },
      ]
    `);
    const [devices, warranty] = tool.calls;
    const [d, w] = run.results;
    expect({
      table: tableView(tool.blocks[0], devices, d),
      picked: fieldRows(tool.blocks[1], devices, d),
      json: jsonText(tool.blocks[2], devices, d),
      warranty: fieldRows(tool.blocks[3], warranty, w),
      dependents: dependentCalls(tool, "devices", findRequest).map((c) => c.id),
      retryAlone: canRetryAlone(tool, "devices", findRequest),
    }).toMatchInlineSnapshot(`
      {
        "dependents": [
          "warranty",
        ],
        "json": "{
        "serial": "D-200",
        "model": "Pixel 8"
      }",
        "picked": [
          {
            "label": "Serial",
            "value": "D-200",
          },
        ],
        "retryAlone": false,
        "table": {
          "columns": [
            "Model",
          ],
          "pickedIndex": 1,
          "rows": [
            [
              "iPhone 15",
            ],
            [
              "Pixel 8",
            ],
          ],
        },
        "warranty": [
          {
            "label": "Until",
            "value": "Feb 1, 2026",
          },
          {
            "label": "Covered",
            "value": "No",
          },
        ],
      }
    `);
  });

  it("a pick-a-row call without a chooser uses the first row; with no pick the dependent is skipped", async () => {
    const tool = pickTool();
    const first = send();
    const run = await runLookup(tool, {}, ctx(first));
    expect(first.urls).toEqual(["https://api/devices", "https://api/warranty/D-100"]);
    const none = send();
    const skipped = await runLookup(tool, {}, ctx(none, { pickRow: async () => null }));
    expect(none.urls).toEqual(["https://api/devices"]);
    expect({ first: plainResults(run.results), skipped: plainResults(skipped.results) }).toMatchInlineSnapshot(`
      {
        "first": [
          {
            "callId": "devices",
            "hasPicks": false,
            "message": undefined,
            "picked": {
              "index": 0,
            },
            "reason": undefined,
            "request": {
              "method": "GET",
              "url": "https://api/devices",
            },
            "rowCount": 2,
            "state": "done",
            "status": 200,
          },
          {
            "callId": "warranty",
            "hasPicks": false,
            "message": undefined,
            "picked": undefined,
            "reason": undefined,
            "request": {
              "method": "GET",
              "url": "https://api/warranty/D-100",
            },
            "rowCount": undefined,
            "state": "done",
            "status": 200,
          },
        ],
        "skipped": [
          {
            "callId": "devices",
            "hasPicks": false,
            "message": undefined,
            "picked": undefined,
            "reason": undefined,
            "request": {
              "method": "GET",
              "url": "https://api/devices",
            },
            "rowCount": 2,
            "state": "done",
            "status": 200,
          },
          {
            "callId": "warranty",
            "hasPicks": false,
            "message": "Needs serial from Devices",
            "picked": undefined,
            "reason": "needs-value",
            "request": undefined,
            "rowCount": undefined,
            "state": "skipped",
            "status": undefined,
          },
        ],
      }
    `);
  });

  it("an empty pick-a-row list skips the dependent", async () => {
    const tool = pickTool();
    tool.calls[0] = { ...tool.calls[0], requestId: "empty" };
    const s = send();
    const run = await runLookup(tool, {}, ctx(s));
    expect(plainResults(run.results)).toMatchInlineSnapshot(`
      [
        {
          "callId": "devices",
          "hasPicks": false,
          "message": undefined,
          "picked": undefined,
          "reason": undefined,
          "request": {
            "method": "GET",
            "url": "https://api/empty",
          },
          "rowCount": 0,
          "state": "done",
          "status": 200,
        },
        {
          "callId": "warranty",
          "hasPicks": false,
          "message": "Needs serial from Devices",
          "picked": undefined,
          "reason": "needs-value",
          "request": undefined,
          "rowCount": undefined,
          "state": "skipped",
          "status": undefined,
        },
      ]
    `);
  });

  it("a table on an object with two lists shows the first list, or the pick-a-row list", async () => {
    const tool = twoListsTool();
    const s = send();
    const run = await runLookup(tool, {}, ctx(s));
    const result = run.results[0];
    const asPick = { ...tool.calls[0], pickRow: { listPath: "$.devices", labelPath: "$.model" } };
    expect({
      first: tableView(tool.blocks[0], tool.calls[0], result),
      devices: tableRows(asPick, { ...result, picked: { index: 1 } }),
    }).toMatchInlineSnapshot(`
      {
        "devices": [
          {
            "model": "iPhone 15",
            "serial": "D-100",
            "serviceId": "s1",
          },
          {
            "model": "Pixel 8",
            "serial": "D-200",
            "serviceId": "s2",
          },
          {
            "model": "iPad",
            "serial": "D-300",
            "serviceId": "s1",
          },
        ],
        "first": {
          "columns": [
            "Service",
            "Status",
          ],
          "pickedIndex": null,
          "rows": [
            [
              "Mobile",
              "active",
            ],
            [
              "Broadband",
              "suspended",
            ],
          ],
        },
      }
    `);
  });

  it("loads and exports unchanged", () => {
    const tools = [plainTool(), pickTool(), twoListsTool()];
    const json = JSON.parse(JSON.stringify(tools));
    expect(cleanTools(json)).toEqual(json);
  });
});

function plainTool(): Tool {
  return plainCall();
}
