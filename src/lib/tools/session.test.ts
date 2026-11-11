import { describe, expect, it, vi } from "vitest";
import type { SendFn } from "../batch";
import { inlineScriptRunner } from "../testing/scriptTestHelper";
import type { PreparedRequest, SendOutcome } from "../types";
import { canRetryAlone } from "./engine";
import { sampleFindRequest, sampleReply, sampleTool } from "./sample";
import { SessionRegistry, ToolSession, pendingRows, type LookupDeps } from "./session";
import { newBlock, newCall, newTool } from "./tools";
import type { LookupRecord, Tool } from "./types";
import { callView } from "./view";

/** A fake server: answers from the sample replies, with a delay per url, and records what was sent. */
function server(delays: (url: string) => number = () => 2, override: (url: string) => { status?: number; body?: unknown } | "error" | null = () => null) {
  const sent: string[] = [];
  const send: SendFn = async (req: PreparedRequest, signal) => {
    sent.push(req.url);
    const delay = delays(req.url);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      });
    });
    const base = { request: req, sentAt: new Date().toISOString() };
    if (signal?.aborted) return { ...base, ok: false, error: "Request cancelled", durationMs: delay } satisfies SendOutcome;
    const o = override(req.url);
    if (o === "error") return { ...base, ok: false, error: "connection refused", durationMs: delay } satisfies SendOutcome;
    const status = o?.status ?? 200;
    const body = JSON.stringify(o?.body ?? sampleReply(req.url));
    return { ...base, ok: true, response: { status, statusText: "", headers: [], body, sizeBytes: body.length, durationMs: delay } } satisfies SendOutcome;
  };
  return { send, sent };
}

function depsOf(send: SendFn, extra: Partial<LookupDeps> = {}): LookupDeps {
  return { findRequest: sampleFindRequest(), envVars: { baseUrl: "https://api.test" }, send, scripts: inlineScriptRunner, save: async () => true, ...extra };
}

describe("ToolSession.lookup", () => {
  it("fills the answers in as each call finishes, so a fast call shows before a slow one", async () => {
    const s = server((url) => (url.endsWith("/devices") ? 60 : 2));
    const session = new ToolSession("t");
    const tool = sampleTool();
    const seen: string[][] = [];
    session.subscribe(() => seen.push(Object.keys(session.getState().results)));
    const pending = session.lookup(tool, depsOf(s.send), { subscriberId: "100234" });
    expect(session.getState().running).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    // Mid-run: the subscriber and what it unlocks are in; the slow devices call is still running.
    const mid = session.getState();
    expect(mid.running).toBe(true);
    expect(Object.keys(mid.results)).toContain("c-subscriber");
    expect(Object.keys(mid.results)).toContain("c-account");
    expect(Object.keys(mid.results)).not.toContain("c-devices");
    expect(mid.sending).toContain("c-devices");
    expect(callView({ result: mid.results["c-devices"], sending: mid.sending.includes("c-devices"), lookingUp: mid.running }).kind).toBe("running");
    const record = await pending;
    const end = session.getState();
    expect(end.running).toBe(false);
    expect(end.sending).toEqual([]);
    expect(Object.keys(end.results).sort()).toEqual(["c-account", "c-devices", "c-invoices", "c-plan", "c-subscriber", "c-usage"]);
    expect(record?.results).toHaveLength(6);
    expect(seen.some((keys) => keys.length === 1)).toBe(true);
  });

  it("sends the four dependent calls with the account id from the subscriber, and the write call never", async () => {
    const s = server();
    const session = new ToolSession("t");
    await session.lookup(sampleTool(), depsOf(s.send), { subscriberId: "100234" });
    expect(s.sent).toContain("https://api.test/accounts/A-77");
    expect(s.sent).toContain("https://api.test/accounts/A-77/usage");
    expect(s.sent).toContain("https://api.test/accounts/A-77/invoices");
    expect(s.sent).toContain("https://api.test/plans/P-5");
    expect(s.sent).toContain("https://api.test/subscribers/100234/devices");
    expect(s.sent.some((u) => u.endsWith("/suspend"))).toBe(false);
  });

  it("uses an input's default when the box is empty", async () => {
    const s = server();
    const session = new ToolSession("t");
    await session.lookup(sampleTool(), depsOf(s.send), {});
    expect(s.sent).toContain("https://api.test/subscribers/100234");
  });

  it("saves the finished lookup with the tool's keep-history setting and the environment name", async () => {
    const save = vi.fn(async (_r: LookupRecord, _keep: boolean) => true);
    const tool = sampleTool();
    tool.settings.keepHistory = false;
    const session = new ToolSession(tool.id);
    const record = await session.lookup(tool, depsOf(server().send, { save, environmentName: "Staging" }), { subscriberId: "9" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe(false);
    expect(save.mock.calls[0][0]).toMatchObject({ toolId: tool.id, toolName: "Subscriber 360", environmentName: "Staging", inputs: { subscriberId: "9" } });
    expect(record?.environmentName).toBe("Staging");
    expect(session.getState().recordId).toBeNull();
  });

  it("keeps the answers when saving history fails", async () => {
    const session = new ToolSession("t");
    const record = await session.lookup(sampleTool(), depsOf(server().send, { save: async () => Promise.reject(new Error("disk full")) }), { subscriberId: "1" });
    expect(record).not.toBeNull();
    expect(Object.keys(session.getState().results).length).toBeGreaterThan(0);
  });

  it("shows a skipped call's message and a failed subscriber stops what depends on it", async () => {
    const s = server(() => 2, (url) => (/\/subscribers\/[^/]+$/.test(url) ? { status: 500, body: { error: "boom" } } : null));
    const session = new ToolSession("t");
    await session.lookup(sampleTool(), depsOf(s.send), { subscriberId: "1" });
    const r = session.getState().results;
    expect(callView({ result: r["c-subscriber"], sending: false, lookingUp: false }).kind).toBe("http-error");
    // The subscriber answered 500 without an account id, so the calls that need it are skipped, not sent.
    expect(r["c-account"]).toMatchObject({ state: "skipped", message: "Needs accountId from Subscriber" });
    expect(s.sent.some((u) => u.includes("/accounts/"))).toBe(false);
    expect(r["c-devices"].state).toBe("done");
  });

  it("reports a network error and 'Request missing' for a deleted request", async () => {
    const find = sampleFindRequest();
    const session = new ToolSession("t");
    await session.lookup(sampleTool(), depsOf(server(() => 2, (url) => (url.endsWith("/devices") ? "error" : null)).send, { findRequest: (id) => (id === "s360-usage" ? null : find(id)) }), { subscriberId: "1" });
    const r = session.getState().results;
    expect(r["c-devices"]).toMatchObject({ state: "network-error", error: "connection refused" });
    expect(r["c-usage"]).toMatchObject({ state: "skipped", reason: "missing-request", message: "Request missing" });
  });

  it("refuses to start with a dependency loop and says why", async () => {
    const t = newTool("Loop");
    const a = { ...newCall("s360-account", "A"), id: "a", mappings: { accountId: { call: { callId: "b", path: "$.x" } } } };
    const b = { ...newCall("s360-account", "B"), id: "b", mappings: { accountId: { call: { callId: "a", path: "$.x" } } } };
    t.calls = [a, b];
    const s = server();
    const session = new ToolSession("t");
    const record = await session.lookup(t, depsOf(s.send));
    expect(record).toBeNull();
    expect(session.getState().error).toMatch(/^Look up can't start/);
    expect(session.getState().running).toBe(false);
    expect(s.sent).toEqual([]);
  });

  it("Stop ends the calls not yet started as Stopped and marks the lookup stopped", async () => {
    const s = server(() => 40);
    const session = new ToolSession("t");
    const pending = session.lookup(sampleTool(), depsOf(s.send), { subscriberId: "1" });
    await new Promise((r) => setTimeout(r, 10));
    session.stop();
    const record = await pending;
    expect(record?.stopped).toBe(true);
    expect(session.getState().stopped).toBe(true);
    expect(session.getState().results["c-account"].state).toBe("stopped");
  });

  it("ignores a second Look up while one is running", async () => {
    const s = server(() => 20);
    const session = new ToolSession("t");
    const first = session.lookup(sampleTool(), depsOf(s.send), { subscriberId: "1" });
    expect(await session.lookup(sampleTool(), depsOf(s.send), { subscriberId: "1" })).toBeNull();
    await first;
    expect(s.sent.filter((u) => u.endsWith("/subscribers/1"))).toHaveLength(1);
  });
});

describe("viewing a saved lookup", () => {
  async function savedRecord(): Promise<LookupRecord> {
    return (await new ToolSession("t").lookup(sampleTool(), depsOf(server().send), { subscriberId: "55" }))!;
  }

  it("shows the saved answers and inputs without sending anything", async () => {
    const record = await savedRecord();
    const s = server();
    const session = new ToolSession("t");
    session.show(record);
    const st = session.getState();
    expect(st.viewing).toBe(record);
    expect(st.recordId).toBe(record.id);
    expect(st.inputs).toEqual({ subscriberId: "55" });
    expect(st.startedAt).toBe(record.startedAt);
    expect(st.running).toBe(false);
    expect(Object.keys(st.results)).toHaveLength(6);
    expect(st.results["c-subscriber"].state).toBe("done");
    expect(s.sent).toEqual([]);
  });

  it("is ignored while a lookup is running, and a new Look up replaces the saved view", async () => {
    const record = await savedRecord();
    const session = new ToolSession("t");
    session.show(record);
    const s = server();
    const pending = session.lookup(sampleTool(), depsOf(s.send), { subscriberId: "56" });
    session.show(record);
    expect(session.getState().viewing).toBeNull();
    await pending;
    expect(session.getState().viewing).toBeNull();
    expect(s.sent).toContain("https://api.test/subscribers/56");
  });

  it("a saved Stopped call shows as stopped, nothing new", async () => {
    const record = await savedRecord();
    const stopped: LookupRecord = { ...record, stopped: true, results: record.results.map((r) => (r.callId === "c-usage" ? { callId: r.callId, name: r.name, state: "stopped" as const } : r)) };
    const session = new ToolSession("t");
    session.show(stopped);
    expect(session.getState().stopped).toBe(true);
    expect(callView({ result: session.getState().results["c-usage"], sending: false, lookingUp: false }).kind).toBe("stopped");
  });
});

describe("pick a row", () => {
  function pickTool(withTable: boolean): Tool {
    const t = sampleTool();
    // The devices call asks which row to use; the plan call needs the picked device.
    t.calls = t.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "$.devices", labelPath: "$.model" } } : c));
    if (!withTable) t.blocks = t.blocks.filter((b) => b.id !== "b-devices");
    t.calls.push({ ...newCall("s360-plan", "Device plan"), id: "c-dplan", mappings: { planId: { call: { callId: "c-devices", path: "$.imei" } } } });
    t.blocks.push(newBlock("fields", 6, { id: "b-dplan", callId: "c-dplan", fields: [{ path: "$.name", label: "Plan", format: "text" }] }));
    return t;
  }

  it("waits for the row chosen in the table, then runs what needs it", async () => {
    const s = server();
    const session = new ToolSession("t");
    const pending = session.lookup(pickTool(true), depsOf(s.send), { subscriberId: "1" });
    await new Promise((r) => setTimeout(r, 30));
    expect(pendingRows(session.getState(), "c-devices")).toHaveLength(2);
    expect(session.getState().running).toBe(true);
    expect(s.sent.some((u) => u.includes("/plans/3502"))).toBe(false);
    session.choosePick("c-devices", 1);
    const record = await pending;
    expect(s.sent).toContain("https://api.test/plans/3502");
    expect(record?.results.find((r) => r.callId === "c-devices")?.picked).toEqual({ index: 1 });
    expect(pendingRows(session.getState(), "c-devices")).toBeNull();
  });

  it("picking none skips what needs the row", async () => {
    const session = new ToolSession("t");
    const pending = session.lookup(pickTool(true), depsOf(server().send), { subscriberId: "1" });
    await new Promise((r) => setTimeout(r, 30));
    session.choosePick("c-devices", null);
    await pending;
    expect(session.getState().results["c-dplan"].state).toBe("skipped");
  });

  it("uses the first row when no table block can show the choice", async () => {
    const s = server();
    const session = new ToolSession("t");
    await session.lookup(pickTool(false), depsOf(s.send), { subscriberId: "1" });
    expect(s.sent).toContain("https://api.test/plans/3501");
    expect(session.getState().pending).toEqual([]);
  });

  it("Stop while choosing ends the lookup", async () => {
    const session = new ToolSession("t");
    const pending = session.lookup(pickTool(true), depsOf(server().send), { subscriberId: "1" });
    await new Promise((r) => setTimeout(r, 30));
    session.stop();
    const record = await pending;
    expect(record?.stopped).toBe(true);
    expect(session.getState().running).toBe(false);
  });
});

describe("SessionRegistry", () => {
  it("keeps one session per tool and says which are running", async () => {
    const reg = new SessionRegistry();
    expect(reg.get("a")).toBe(reg.get("a"));
    expect(reg.runningIds()).toEqual([]);
    const versions = [reg.getVersion()];
    reg.subscribe(() => versions.push(reg.getVersion()));
    const pending = reg.get("a").lookup(sampleTool(), depsOf(server(() => 20).send), { subscriberId: "1" });
    expect(reg.runningIds()).toEqual(["a"]);
    await pending;
    expect(reg.runningIds()).toEqual([]);
    expect(new Set(versions).size).toBeGreaterThan(2);
  });

  it("stops a dropped tool's lookup", async () => {
    const reg = new SessionRegistry();
    const pending = reg.get("a").lookup(sampleTool(), depsOf(server(() => 50).send), { subscriberId: "1" });
    await new Promise((r) => setTimeout(r, 10));
    reg.drop("a");
    expect((await pending)?.stopped).toBe(true);
    expect(reg.runningIds()).toEqual([]);
  });
});

describe("ToolSession.runAction and retryCall", () => {
  const env = (color: "red" | "none") => ({ id: "e", name: "Prod", vars: [], color }) as never;

  it("sends a write call after a lookup, keeps the result, and clears it when the next lookup starts", async () => {
    const s = server();
    const session = new ToolSession("t");
    const tool = sampleTool();
    await session.lookup(tool, depsOf(s.send), { subscriberId: "100234" });
    const confirm = vi.fn(async () => true);
    const r = await session.runAction(tool, "c-suspend", { ...depsOf(s.send), environment: env("none"), confirm });
    expect(r?.state).toBe("done");
    expect(confirm).not.toHaveBeenCalled();
    expect(session.getState().writes["c-suspend"]).toBe(r);
    expect(session.getState().writing).toEqual([]);
    const pending = session.lookup(tool, depsOf(s.send), { subscriberId: "100234" });
    expect(session.getState().writes).toEqual({});
    await pending;
  });

  it("asks on a coloured environment and does not send when declined", async () => {
    const s = server();
    const session = new ToolSession("t");
    const confirm = vi.fn(async () => false);
    const r = await session.runAction(sampleTool(), "c-suspend", { ...depsOf(s.send), environment: env("red"), confirm }, false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ state: "skipped", reason: "not-confirmed" });
    expect(s.sent).toEqual([]);
  });

  it("asks on an unmarked environment when the block has confirm text, with no guard", async () => {
    const s = server();
    const session = new ToolSession("t");
    const confirm = vi.fn(async () => false);
    const r = await session.runAction(sampleTool(), "c-suspend", { ...depsOf(s.send), environment: env("none"), confirm }, true);
    expect(confirm).toHaveBeenCalledWith(null, "c-suspend");
    expect(r?.reason).toBe("not-confirmed");
    expect(s.sent).toEqual([]);
  });

  it("retries one call alone when nothing depends on it, and leaves the other answers as they are", async () => {
    const s = server();
    const session = new ToolSession("t");
    const tool = sampleTool();
    await session.lookup(tool, depsOf(s.send), { subscriberId: "100234" });
    const before = session.getState().results;
    s.sent.length = 0;
    const r = await session.retryCall(tool, "c-devices", depsOf(s.send));
    expect(r?.state).toBe("done");
    expect(s.sent).toEqual(["https://api.test/subscribers/100234/devices"]);
    expect(session.getState().results["c-account"]).toBe(before["c-account"]);
    expect(session.getState().results["c-devices"]).toBe(r);
  });
});

describe("canRetryAlone", () => {
  it("is false for a call others read from, a write call and a pick-a-row call", () => {
    const tool = sampleTool();
    const find = sampleFindRequest();
    expect(canRetryAlone(tool, "c-devices", find)).toBe(true);
    expect(canRetryAlone(tool, "c-subscriber", find)).toBe(false);
    expect(canRetryAlone(tool, "c-suspend", find)).toBe(false);
    const pick = { ...tool, calls: tool.calls.map((c) => (c.id === "c-devices" ? { ...c, pickRow: { listPath: "devices", labelPath: "model" } } : c)) };
    expect(canRetryAlone(pick, "c-devices", find)).toBe(false);
  });
});

describe("sample tool", () => {
  it("has no problems and uses only blocks the page can draw", () => {
    const t = sampleTool();
    expect(new Set(t.blocks.map((b) => b.type))).toEqual(new Set(["input", "fields", "status", "number", "table", "json", "note", "action"]));
    expect(t.calls.filter((c) => c.write).map((c) => c.id)).toEqual(["c-suspend"]);
  });
});
