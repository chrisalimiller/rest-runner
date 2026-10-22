import { describe, expect, it } from "vitest";
import { newCollection, newFolder, requestNode, type Collection } from "./collections";
import { newRequest } from "./defaults";
import { collectionItems, fuzzyScore, historyItems, KIND_ORDER, searchQuickOpen, suiteItems, type QuickItem } from "./quickOpen";
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
