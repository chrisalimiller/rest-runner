import { describe, expect, it } from "vitest";
import {
  addExample,
  canMove,
  cleanCollections,
  countRequests,
  destinations,
  duplicate,
  insertAt,
  listRequests,
  locate,
  migrateSavedRequests,
  move,
  newCollection,
  newFolder,
  remove,
  removeWithRestore,
  rename,
  requestNode,
  updateExample,
  updateRequest,
  type Collection,
} from "./collections";
import { newRequest } from "./defaults";

function setup() {
  const a = { ...newRequest(), name: "A" };
  const b = { ...newRequest(), name: "B" };
  const folder = newFolder("Users");
  const sub = newFolder("Admin");
  const col: Collection = { ...newCollection("API"), items: [requestNode(a), { ...folder, items: [{ ...sub, items: [requestNode(b)] }] }] };
  return { a, b, folder, sub, col, cols: [col] };
}

describe("collections", () => {
  it("migrates old saved requests into one collection", () => {
    expect(migrateSavedRequests([])).toEqual([]);
    const cols = migrateSavedRequests([newRequest(), newRequest()]);
    expect(cols).toHaveLength(1);
    expect(countRequests(cols[0].items)).toBe(2);
  });

  it("locates nodes and lists requests with folder paths", () => {
    const { b, sub, cols } = setup();
    const found = locate(cols, b.id);
    expect(found?.kind).toBe("request");
    expect(found && "path" in found ? found.path.map((f) => f.name) : []).toEqual(["Users", "Admin"]);
    expect(locate(cols, sub.id)?.kind).toBe("folder");
    expect(listRequests(cols).map((r) => [r.request.name, r.folderPath.join("/")])).toEqual([
      ["A", ""],
      ["B", "Users/Admin"],
    ]);
  });

  it("adds, updates, renames and removes examples", () => {
    const { a, cols } = setup();
    const { collections, example } = addExample(cols, a.id, "Bad input", { ...a, body: "{}" }, { status: 400, statusText: "Bad", headers: [], body: "" });
    expect(example.request.id).toBe(example.id);
    expect(locate(collections, example.id)?.kind).toBe("example");
    const updated = updateExample(collections, { ...example.request, body: "{\"x\":1}" });
    const ex = locate(updated, example.id);
    expect(ex?.kind === "example" && ex.example.request.body).toBe('{"x":1}');
    expect(ex?.kind === "example" && ex.example.response?.status).toBe(400);
    const renamed = rename(updated, example.id, "Empty");
    const r = locate(renamed, example.id);
    expect(r?.kind === "example" && r.example.name).toBe("Empty");
    expect(locate(remove(renamed, example.id), example.id)).toBeNull();
    expect(locate(remove(renamed, example.id), a.id)?.kind).toBe("request");
  });

  it("updates a request but keeps its examples", () => {
    const { a, cols } = setup();
    const withEx = addExample(cols, a.id, "Ex", a).collections;
    const next = updateRequest(withEx, { ...a, url: "https://x" });
    const found = locate(next, a.id);
    expect(found?.kind === "request" && found.node.request.url).toBe("https://x");
    expect(found?.kind === "request" && found.node.examples).toHaveLength(1);
  });

  it("removes folders with their contents", () => {
    const { b, folder, cols } = setup();
    const next = remove(cols, folder.id);
    expect(locate(next, b.id)).toBeNull();
    expect(countRequests(next[0].items)).toBe(1);
  });

  it("duplicates with new ids", () => {
    const { folder, cols } = setup();
    const r = duplicate(cols, folder.id);
    expect(r.newId).not.toBeNull();
    expect(listRequests(r.collections)).toHaveLength(3);
    const ids = listRequests(r.collections).map((x) => x.request.id);
    expect(new Set(ids).size).toBe(3);
    expect(r.collections[0].items.map((i) => (i.kind === "folder" ? i.name : i.request.name))).toEqual(["A", "Users", "Users copy"]);
  });

  it("moves requests and folders but not a folder into itself", () => {
    const { a, folder, sub, col, cols } = setup();
    expect(canMove(cols, folder.id, { collectionId: col.id, folderId: sub.id })).toBe(false);
    expect(canMove(cols, folder.id, { collectionId: col.id, folderId: folder.id })).toBe(false);
    expect(move(cols, folder.id, { collectionId: col.id, folderId: sub.id })).toBe(cols);
    const moved = move(cols, a.id, { collectionId: col.id, folderId: sub.id });
    expect(listRequests(moved).map((r) => [r.request.name, r.folderPath.join("/")])).toEqual([
      ["B", "Users/Admin"],
      ["A", "Users/Admin"],
    ]);
    const other = newCollection("Other");
    const across = move([...cols, other], sub.id, { collectionId: other.id, folderId: null });
    expect(listRequests(across).map((r) => [r.collectionName, r.request.name])).toEqual([
      ["API", "A"],
      ["Other", "B"],
    ]);
  });

  it("lists destinations and inserts", () => {
    const { col, sub, cols } = setup();
    expect(destinations(cols).map((d) => d.label)).toEqual(["API", "API / Users", "API / Users / Admin"]);
    const next = insertAt(cols, { collectionId: col.id, folderId: sub.id }, [requestNode(newRequest())]);
    expect(countRequests(next[0].items)).toBe(3);
  });

  it("cleans bad data from storage", () => {
    expect(cleanCollections("x")).toEqual([]);
    expect(cleanCollections([{ id: "c", name: "C", items: [{ kind: "nope" }] }])).toEqual([{ id: "c", name: "C", items: [] }]);
  });
});

describe("removeWithRestore", () => {
  const build = () => {
    const a = { ...newRequest(), name: "A" };
    const b = { ...newRequest(), name: "B" };
    const c = { ...newRequest(), name: "C" };
    const folder = { ...newFolder("F"), items: [requestNode(a), requestNode(b)] };
    const col = { ...newCollection("Col"), items: [folder, requestNode(c)] };
    return { a, b, c, folder, col, cols: [col, newCollection("Other")] };
  };

  it("puts a request back at its old position", () => {
    const { a, b, cols, folder } = build();
    const r = removeWithRestore(cols, a.id)!;
    expect(listRequests(r.collections).map((x) => x.request.name)).toEqual(["B", "C"]);
    const back = r.restore(r.collections);
    expect(listRequests(back).map((x) => x.request.name)).toEqual(["A", "B", "C"]);
    expect((back[0].items[0] as typeof folder).items.map((n) => n.id)).toEqual([a.id, b.id]);
  });

  it("restores into the current state, keeping changes made since", () => {
    const { a, cols } = build();
    const r = removeWithRestore(cols, a.id)!;
    const edited = [...r.collections, newCollection("Added meanwhile")];
    expect(r.restore(edited).map((c) => c.name)).toEqual(["Col", "Other", "Added meanwhile"]);
    expect(listRequests(r.restore(edited))).toHaveLength(3);
  });

  it("restores a folder with its contents, and a collection in place", () => {
    const { folder, cols } = build();
    const f = removeWithRestore(cols, folder.id)!;
    expect(listRequests(f.collections)).toHaveLength(1);
    expect(listRequests(f.restore(f.collections))).toHaveLength(3);
    const c = removeWithRestore(cols, cols[0].id)!;
    expect(c.collections.map((x) => x.name)).toEqual(["Other"]);
    expect(c.restore(c.collections).map((x) => x.name)).toEqual(["Col", "Other"]);
  });

  it("restores an example, and does not duplicate on a second restore", () => {
    const { a } = build();
    const node = addExample([{ ...newCollection("X"), items: [requestNode(a)] }], a.id, "Ex", a);
    const r = removeWithRestore(node.collections, node.example.id)!;
    expect(locate(r.collections, node.example.id)).toBeNull();
    const back = r.restore(r.collections);
    expect(locate(back, node.example.id)?.kind).toBe("example");
    expect(r.restore(back)).toEqual(back);
  });

  it("returns null for an unknown id", () => {
    expect(removeWithRestore([], "nope")).toBeNull();
  });
});
