import { describe, expect, it } from "vitest";
import { filterEnvs, pushRecent, recentEnvs } from "./envPicker";

describe("envPicker", () => {
  it("pushRecent moves to front, dedupes and caps", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
  it("filterEnvs matches case-insensitively", () => {
    const items = [{ name: "Staging EU" }, { name: "Production" }];
    expect(filterEnvs(items, " eu")).toEqual([{ name: "Staging EU" }]);
    expect(filterEnvs(items, "")).toHaveLength(2);
    expect(filterEnvs(items, "zzz")).toEqual([]);
  });
  it("recentEnvs drops missing ids and keeps order", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(recentEnvs(items, ["c", "gone", "a"])).toEqual([{ id: "c" }, { id: "a" }]);
    expect(recentEnvs(items, ["c", "b", "a"], 2)).toEqual([{ id: "c" }, { id: "b" }]);
  });
});
