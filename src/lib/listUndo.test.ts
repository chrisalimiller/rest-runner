import { describe, expect, it } from "vitest";
import { reinsert, removeById } from "./listUndo";

describe("removeById / reinsert", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("removes and puts back in place", () => {
    const r = removeById(list, "b")!;
    expect(r.list.map((x) => x.id)).toEqual(["a", "c"]);
    expect(reinsert(r.list, r.item, r.index).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps edits made meanwhile and clamps the position", () => {
    const r = removeById(list, "c")!;
    expect(reinsert([{ id: "a" }], r.item, r.index).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("does not duplicate and ignores unknown ids", () => {
    expect(reinsert(list, list[0], 0)).toBe(list);
    expect(removeById(list, "zz")).toBeNull();
  });
});
