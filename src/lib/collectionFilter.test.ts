import { describe, expect, it } from "vitest";
import { allNodeIds, filterCollections } from "./collectionFilter";
import { newCollection, newFolder, requestNode, type Collection } from "./collections";
import { newRequest } from "./defaults";

const req = (name: string, url = "") => ({ ...newRequest(), name, url });

function tree(): Collection[] {
  const orders = newFolder("Orders");
  orders.items = [requestNode(req("Create order", "https://api.example.com/orders")), requestNode(req("Cancel order"))];
  const auth = newFolder("Auth");
  auth.items = [requestNode(req("Get access token", "https://auth.example.com/token"))];
  const shop = newCollection("Shop API");
  shop.items = [orders, auth, requestNode(req("Health"))];
  const echo = newCollection("Echo");
  echo.items = [requestNode(req("Echo a GET"))];
  return [shop, echo];
}

const names = (cols: Collection[]): string[] =>
  cols.flatMap((c) => [c.name, ...c.items.flatMap((n): string[] => (n.kind === "folder" ? [n.name, ...n.items.map((r) => (r.kind === "request" ? r.request.name : r.name))] : [n.request.name]))]);

describe("filterCollections", () => {
  it("returns the same tree for an empty search", () => {
    const cols = tree();
    expect(filterCollections(cols, "")).toBe(cols);
    expect(filterCollections(cols, "   ")).toBe(cols);
  });

  it("keeps only the branches with a matching request, case-insensitively", () => {
    expect(names(filterCollections(tree(), "ORDER"))).toEqual(["Shop API", "Orders", "Create order", "Cancel order"]);
  });

  it("matches a request by its URL", () => {
    expect(names(filterCollections(tree(), "auth.example"))).toEqual(["Shop API", "Auth", "Get access token"]);
  });

  it("keeps everything inside a folder or collection whose own name matches", () => {
    expect(names(filterCollections(tree(), "auth"))).toEqual(["Shop API", "Auth", "Get access token"]);
    expect(names(filterCollections(tree(), "echo"))).toEqual(["Echo", "Echo a GET"]);
  });

  it("drops collections with no match and returns an empty list when nothing matches", () => {
    expect(filterCollections(tree(), "zzz")).toEqual([]);
  });

  it("keeps a request whose example matches, with only the matching examples", () => {
    const r = requestNode(req("Create order"), [
      { id: "e1", name: "Out of stock", request: req("Out of stock") },
      { id: "e2", name: "Happy path", request: req("Happy path") },
    ]);
    const col = newCollection("Shop");
    col.items = [r];
    const out = filterCollections([col], "stock");
    const kept = out[0].items[0];
    expect(kept.kind === "request" && kept.examples.map((e) => e.name)).toEqual(["Out of stock"]);
  });

  it("does not change the tree it was given", () => {
    const cols = tree();
    const before = JSON.stringify(cols);
    filterCollections(cols, "order");
    expect(JSON.stringify(cols)).toBe(before);
  });
});

describe("allNodeIds", () => {
  it("lists collections, folders and requests", () => {
    const cols = tree();
    const ids = allNodeIds(cols);
    expect(ids.has(cols[0].id)).toBe(true);
    expect(ids.has(cols[1].id)).toBe(true);
    const folder = cols[0].items[0];
    expect(ids.has(folder.id)).toBe(true);
    expect(ids.size).toBe(2 + 2 + 5);
  });
});
