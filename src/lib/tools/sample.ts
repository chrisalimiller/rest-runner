import type { Collection } from "../collections";
import { newCollection, requestNode } from "../collections";
import { newRequest } from "../defaults";
import type { RequestLookup } from "../flows/flows";
import type { RequestDef } from "../types";
import { newBlock, newCall, newInput, newTool } from "./tools";
import type { PlaceholderMapping, Tool } from "./types";

/**
 * "Subscriber 360": the example tool used by the tests and by the dev-only loader in the Tools empty state.
 * Tools are built by hand until Build mode exists, so this is the one worked example.
 *
 * One input (subscriberId). "Get subscriber" runs first; its $.account.id unlocks four calls
 * (Account, Usage, Invoices, Plan). "List devices" only needs the input, so it runs at the same time.
 */

export const SAMPLE_TOOL_ID = "sample-subscriber-360";
export const SAMPLE_COLLECTION_NAME = "Subscriber 360 (example requests)";

function req(id: string, name: string, url: string, method: RequestDef["method"] = "GET"): RequestDef {
  return { ...newRequest(), id, name, method, url };
}

export function sampleRequests(): RequestDef[] {
  return [
    req("s360-subscriber", "Get subscriber", "{{baseUrl}}/subscribers/{{subscriberId}}"),
    req("s360-account", "Get account", "{{baseUrl}}/accounts/{{accountId}}"),
    req("s360-usage", "Get usage", "{{baseUrl}}/accounts/{{accountId}}/usage"),
    req("s360-invoices", "List invoices", "{{baseUrl}}/accounts/{{accountId}}/invoices"),
    req("s360-plan", "Get plan", "{{baseUrl}}/plans/{{planId}}"),
    req("s360-devices", "List devices", "{{baseUrl}}/subscribers/{{subscriberId}}/devices"),
    req("s360-suspend", "Suspend subscriber", "{{baseUrl}}/subscribers/{{subscriberId}}/suspend", "POST"),
  ];
}

export function sampleFindRequest(): RequestLookup {
  const byId = new Map(sampleRequests().map((r) => [r.id, r]));
  return (id) => byId.get(id) ?? null;
}

const fromInput = (name: string): PlaceholderMapping => ({ input: name });
const fromCall = (callId: string, path: string): PlaceholderMapping => ({ call: { callId, path } });

export function sampleTool(): Tool {
  const t = newTool("Subscriber 360");
  t.id = SAMPLE_TOOL_ID;
  t.description = "Look up a subscriber and see their account, usage, invoices, plan and devices.";
  t.inputs = [{ ...newInput("subscriberId"), label: "Subscriber ID", default: "100234" }];

  const sub = { ...newCall("s360-subscriber", "Subscriber"), id: "c-subscriber", mappings: { subscriberId: fromInput("subscriberId") } };
  const account = { ...newCall("s360-account", "Account"), id: "c-account", mappings: { accountId: fromCall(sub.id, "$.account.id") } };
  const usage = { ...newCall("s360-usage", "Usage"), id: "c-usage", mappings: { accountId: fromCall(sub.id, "$.account.id") } };
  const invoices = { ...newCall("s360-invoices", "Invoices"), id: "c-invoices", mappings: { accountId: fromCall(sub.id, "$.account.id") } };
  const plan = { ...newCall("s360-plan", "Plan"), id: "c-plan", mappings: { planId: fromCall(sub.id, "$.account.planId") } };
  const devices = { ...newCall("s360-devices", "Devices"), id: "c-devices", mappings: { subscriberId: fromInput("subscriberId") } };
  const suspend = { ...newCall("s360-suspend", "Suspend", "POST"), id: "c-suspend", mappings: { subscriberId: fromInput("subscriberId") } };
  t.calls = [sub, account, usage, invoices, plan, devices, suspend];

  t.blocks = [
    newBlock("input", 0, { id: "b-input", title: "Look up", inputName: "subscriberId" }),
    newBlock("fields", 1, {
      id: "b-subscriber",
      title: "Subscriber",
      callId: sub.id,
      fields: [
        { path: "$.name", label: "Name", format: "text" },
        { path: "$.joined", label: "Customer since", format: "date" },
        { path: "$.autoPay", label: "Auto-pay", format: "yes-no" },
      ],
    }),
    newBlock("status", 1, {
      id: "b-status",
      title: "Account status",
      callId: account.id,
      fields: [{ path: "$.status", label: "Status", format: "text" }],
      text: "active = green\nsuspended = red\npast due = amber",
    }),
    newBlock("number", 1, { id: "b-balance", title: "Balance", callId: account.id, fields: [{ path: "$.balance", label: "Balance", format: "money" }], text: "USD" }),
    newBlock("number", 2, { id: "b-usage", title: "Data used", callId: usage.id, fields: [{ path: "$.dataGb", label: "Data", format: "number" }], text: "GB" }),
    newBlock("table", 2, {
      id: "b-invoices",
      title: "Invoices",
      callId: invoices.id,
      fields: [
        { path: "$.number", label: "Invoice", format: "text" },
        { path: "$.amount", label: "Amount", format: "money" },
        { path: "$.paid", label: "Paid", format: "yes-no" },
      ],
    }),
    newBlock("fields", 3, { id: "b-plan", title: "Plan", callId: plan.id, fields: [{ path: "$.name", label: "Plan", format: "text" }, { path: "$.monthly", label: "Monthly", format: "money" }] }),
    newBlock("table", 3, {
      id: "b-devices",
      title: "Devices",
      callId: devices.id,
      fields: [
        { path: "$.model", label: "Model", format: "text" },
        { path: "$.imei", label: "IMEI", format: "text" },
      ],
    }),
    newBlock("json", 4, { id: "b-json", title: "Subscriber response", callId: sub.id }),
    newBlock("note", 5, { id: "b-note", title: "Tip", text: "The account number comes from the subscriber record." }),
    newBlock("action", 5, { id: "b-suspend", title: "Suspend", callId: suspend.id }),
  ];
  return t;
}

/** The example requests as a collection, so the example tool has saved requests to run. Dev-only loader. */
export function sampleCollection(): Collection {
  const c = newCollection(SAMPLE_COLLECTION_NAME);
  c.items = sampleRequests().map((r) => requestNode(r));
  return c;
}

/** What the fake server in tests answers for each request of the example tool. */
export function sampleReply(url: string): unknown {
  if (/\/subscribers\/[^/]+\/devices$/.test(url)) return { devices: [{ model: "Pixel 9", imei: "3501" }, { model: "iPad", imei: "3502" }] };
  if (/\/subscribers\/[^/]+$/.test(url)) return { id: "100234", name: "Ada Lovelace", joined: "2021-03-14", autoPay: true, account: { id: "A-77", planId: "P-5" } };
  if (/\/accounts\/[^/]+\/usage$/.test(url)) return { dataGb: 12.5 };
  if (/\/accounts\/[^/]+\/invoices$/.test(url)) return { invoices: [{ number: "INV-1", amount: 40, paid: true }, { number: "INV-2", amount: 40, paid: false }] };
  if (/\/accounts\/[^/]+$/.test(url)) return { status: "active", balance: 40 };
  if (/\/plans\/[^/]+$/.test(url)) return { name: "Unlimited", monthly: 40 };
  return {};
}
