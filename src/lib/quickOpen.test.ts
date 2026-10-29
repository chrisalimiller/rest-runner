import { describe, expect, it } from "vitest";
import { newCollection, newFolder, requestNode, type Collection } from "./collections";
import { newRequest } from "./defaults";
import { newFlow, newNode } from "./flows/flows";
import type { FlowRunSummary } from "./flows/types";
import { collectionItems, commandItems, flowItems, flowRunItems, fuzzyScore, historyItems, KIND_ORDER, readableUrl, searchQuickOpen, suiteItems, type QuickItem } from "./quickOpen";
import { newSuite, newTestCase } from "./testing/suites";

function sampleCollections(): Collection[] {
  const c = newCollection("NaaP E-Bonding");
  const folder = newFolder("Trouble Ticket");
  const create = { ...newRequest(), id: "create", name: "Create ticket", method: "POST" as const };
  const get = { ...newRequest(), id: "get", name: "Get ticket" };
  folder.items = [requestNode(create, [{ id: "ex1", name: "Major severity", request: create }]), requestNode(get)];
  c.items = [folder, requestNode({ ...newRequest(), id: "health", name: "Health check" })];
  return [c];
}

describe("fuzzyScore", () => {
  it("needs every character in order", () => {
    expect(fuzzyScore("crt", "Create ticket")).not.toBeNull();
    expect(fuzzyScore("tc", "Create")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("ranks direct and word-start matches higher", () => {
    expect(fuzzyScore("ticket", "Create ticket")!).toBeGreaterThan(fuzzyScore("ticket", "the incident keyset")!);
    expect(fuzzyScore("tick", "Get ticket")!).toBeGreaterThan(fuzzyScore("tick", "the incident keyset")!);
  });
});

describe("collectionItems", () => {
  it("lists requests and examples with their folder path", () => {
    const items = collectionItems(sampleCollections());
    expect(items.map((i) => `${i.kind}:${i.title}:${i.detail}`)).toEqual([
      "request:Create ticket:NaaP E-Bonding › Trouble Ticket",
      "example:Major severity:NaaP E-Bonding › Trouble Ticket › Create ticket",
      "request:Get ticket:NaaP E-Bonding › Trouble Ticket",
      "request:Health check:NaaP E-Bonding",
    ]);
  });
});

describe("searchQuickOpen", () => {
  const suite = { ...newSuite(), name: "Ticket lifecycle" };
  suite.cases = [{ ...newTestCase(), name: "Create ticket case" }];
  const items: QuickItem[] = [
    ...collectionItems(sampleCollections()),
    ...historyItems([
      { id: "h1", method: "GET", url: "https://api.x/health", status: 200, sentAt: "2026-10-22T10:00:00Z", def: newRequest() },
      { id: "h2", method: "GET", url: "https://api.x/tickets", status: 500, sentAt: "2026-10-22T12:00:00Z", def: newRequest() },
    ]),
    ...suiteItems([suite]),
  ];

  it("groups by type in the given order, best match first", () => {
    const groups = searchQuickOpen(items, "ticket", KIND_ORDER.requests);
    expect(groups.map((g) => g.kind)).toEqual(["request", "example", "history", "suite", "case"]);
    expect(groups[0].items.map((i) => i.title).sort()).toEqual(["Create ticket", "Get ticket"]);
    expect(searchQuickOpen(items, "create", KIND_ORDER.requests)[0].items[0].title).toBe("Create ticket");
    expect(searchQuickOpen(items, "ticket", KIND_ORDER.testing)[0].kind).toBe("suite");
  });

  it("drops groups with no match", () => {
    expect(searchQuickOpen(items, "health", KIND_ORDER.requests).map((g) => g.kind)).toEqual(["request", "history"]);
    expect(searchQuickOpen(items, "zzzz", KIND_ORDER.requests)).toEqual([]);
  });

  it("shows recent items first with no query", () => {
    const history = searchQuickOpen(items, "", KIND_ORDER.requests).find((g) => g.kind === "history");
    expect(history?.items.map((i) => i.id)).toEqual(["h2", "h1"]);
  });

  it("caps each group", () => {
    expect(searchQuickOpen(items, "", KIND_ORDER.requests, 1).every((g) => g.items.length === 1)).toBe(true);
  });
});

describe("flow items", () => {
  it("lists flows with their step count and flow runs with their result", () => {
    const f = newFlow("Nightly smoke");
    f.nodes.push(newNode("schedule"), newNode("run-suite"), newNode("note"));
    expect(flowItems([f])).toEqual([{ kind: "flow", id: f.id, title: "Nightly smoke", detail: "1 step" }]);
    const run: FlowRunSummary = {
      id: "r1",
      kind: "flow",
      flowId: f.id,
      flowName: "Nightly smoke",
      startedAt: "2026-10-25T09:00:00.000Z",
      finishedAt: "2026-10-25T09:00:05.000Z",
      trigger: "node-1",
      end: "failed",
      steps: 3,
      passedSteps: 1,
      failedSteps: 1,
    };
    expect(flowRunItems([run])[0]).toMatchObject({ kind: "flow-run", title: "Nightly smoke", detail: "failed · 1 passed, 1 failed · scheduled" });
    const groups = searchQuickOpen([...flowItems([f]), ...flowRunItems([run])], "night", KIND_ORDER.flows);
    expect(groups.map((g) => g.kind)).toEqual(["flow", "flow-run"]);
  });
});

describe("history items", () => {
  it("lead with the request name, then status, time and decoded path", () => {
    const [item] = historyItems([
      { id: "h1", method: "POST", url: "https://api.x/troubleTicket?fields=id%2Cstatus", status: 201, sentAt: "2026-10-22T10:00:00Z", def: { ...newRequest(), name: "Create ticket" } },
    ]);
    expect(item.title).toBe("Create ticket");
    expect(item.detail.startsWith("201 · ")).toBe(true);
    expect(item.detail.endsWith(" · api.x/troubleTicket?fields=id,status")).toBe(true);
  });

  it("fall back to the URL when the request has no name", () => {
    const [item] = historyItems([{ id: "h2", method: "GET", url: "https://api.x/health", status: null, sentAt: "", def: { ...newRequest(), name: "" } }]);
    expect(item.title).toBe("api.x/health");
    expect(item.detail).toBe("ERR · api.x/health");
  });

  it("still find history by URL", () => {
    const items = historyItems([{ id: "h3", method: "GET", url: "https://api.x/tickets/42", status: 200, sentAt: "2026-10-22T10:00:00Z", def: { ...newRequest(), name: "Get ticket" } }]);
    expect(searchQuickOpen(items, "tickets/42", KIND_ORDER.requests)[0].items[0].id).toBe("h3");
  });
});

describe("readableUrl", () => {
  it("drops the scheme and decodes escapes, keeping bad escapes as written", () => {
    expect(readableUrl("https://a.b/x?q=a%20b%2Cc")).toBe("a.b/x?q=a b,c");
    expect(readableUrl("http://a.b/%E0%A4%A")).toBe("a.b/%E0%A4%A");
  });
});

describe("command items", () => {
  const items = [...commandItems(), ...collectionItems(sampleCollections())];

  it("are hidden with no query and found by curl, paste or import", () => {
    expect(searchQuickOpen(items, "", KIND_ORDER.requests).map((g) => g.kind)).not.toContain("command");
    for (const q of ["curl", "cu", "paste", "import", "Import from"]) {
      const groups = searchQuickOpen(items, q, KIND_ORDER.requests);
      expect(groups[0]).toMatchObject({ kind: "command", label: "Commands" });
      expect(groups[0].items[0].title).toBe("Import from cURL…");
    }
  });

  it("do not match unrelated or one-letter queries", () => {
    expect(searchQuickOpen(items, "r", KIND_ORDER.requests).map((g) => g.kind)).not.toContain("command");
    expect(searchQuickOpen(items, "ticket", KIND_ORDER.requests).map((g) => g.kind)).not.toContain("command");
  });

  it("come first in every mode", () => {
    for (const order of Object.values(KIND_ORDER)) expect(order[0]).toBe("command");
  });
});
