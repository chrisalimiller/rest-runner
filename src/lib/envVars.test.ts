import { describe, expect, it } from "vitest";
import { addMissingVar, buildMatrix, findDuplicateNames, joinRowNumbers, revealKey, setVarValue } from "./envVars";
import type { Environment } from "./environments";
import type { KeyValue } from "./types";

const kv = (id: string, key: string, value = "", extra: Partial<KeyValue> = {}): KeyValue => ({ id, key, value, enabled: true, ...extra });
const env = (id: string, vars: KeyValue[]): Environment => ({ id, name: id, vars });

describe("findDuplicateNames", () => {
  it("finds none in unique rows", () => {
    expect(findDuplicateNames([kv("a", "x"), kv("b", "y")]).groups).toEqual([]);
  });
  it("reports rows (1-based) and points later copies at the first", () => {
    const r = findDuplicateNames([kv("a", "baseUrl"), kv("b", "token"), kv("c", "baseUrl"), kv("d", "baseUrl")]);
    expect(r.groups).toEqual([{ name: "baseUrl", rows: [1, 3, 4] }]);
    expect(r.firstRowOf.get("c")).toBe(1);
    expect(r.firstRowOf.get("d")).toBe(1);
    expect(r.firstRowOf.has("a")).toBe(false);
  });
  it("is case-sensitive and trims", () => {
    expect(findDuplicateNames([kv("a", "Token"), kv("b", "token")]).groups).toEqual([]);
    expect(findDuplicateNames([kv("a", "token"), kv("b", " token ")]).groups).toHaveLength(1);
  });
  it("ignores blank names and disabled rows", () => {
    expect(findDuplicateNames([kv("a", ""), kv("b", ""), kv("c", "x"), kv("d", "x", "", { enabled: false })]).groups).toEqual([]);
  });
});

describe("joinRowNumbers", () => {
  it("joins", () => {
    expect(joinRowNumbers([1])).toBe("1");
    expect(joinRowNumbers([1, 4])).toBe("1 and 4");
    expect(joinRowNumbers([1, 4, 7])).toBe("1, 4 and 7");
  });
});

describe("buildMatrix", () => {
  const envs = [
    env("prod", [kv("1", "baseUrl", "p"), kv("2", "region", "eu"), kv("3", "", "")]),
    env("dev", [kv("4", "baseUrl", "d"), kv("5", "tenant", "t", { secret: true })]),
  ];
  it("takes the union of names in first-seen order", () => {
    expect(buildMatrix(envs).rows.map((r) => r.name)).toEqual(["baseUrl", "region", "tenant"]);
  });
  it("marks missing cells and counts them", () => {
    const m = buildMatrix(envs);
    expect(m.missing).toBe(2);
    expect(m.rows[1].cells.map((c) => c.row?.id ?? null)).toEqual(["2", null]);
    expect(m.rows[2].cells.map((c) => c.row?.id ?? null)).toEqual([null, "5"]);
  });
  it("flags a row secret when any environment says so", () => {
    expect(buildMatrix(envs).rows.map((r) => r.secret)).toEqual([false, false, true]);
  });
  it("uses the last row when a name repeats", () => {
    const m = buildMatrix([env("a", [kv("1", "x", "one"), kv("2", "x", "two")])]);
    expect(m.rows[0].cells[0].row?.value).toBe("two");
  });
  it("handles no environments", () => {
    expect(buildMatrix([])).toEqual({ rows: [], missing: 0 });
  });
});

describe("addMissingVar", () => {
  const envs = [env("prod", [kv("1", "tenant", "x", { secret: true })]), env("dev", [kv("2", "a", "1"), kv("3", "", "")])];
  it("adds an empty variable before the trailing blank row, inheriting secret", () => {
    const next = addMissingVar(envs, "dev", "tenant");
    const vars = next[1].vars;
    expect(vars.map((v) => v.key)).toEqual(["a", "tenant", ""]);
    expect(vars[1]).toMatchObject({ value: "", enabled: true, secret: true });
    expect(buildMatrix(next).missing).toBe(1);
  });
  it("appends a blank row when there was none", () => {
    const next = addMissingVar(envs, "prod", "a");
    expect(next[0].vars.map((v) => v.key)).toEqual(["tenant", "a", ""]);
  });
  it("does not touch other environments or add twice", () => {
    const next = addMissingVar(envs, "dev", "tenant");
    expect(next[0]).toBe(envs[0]);
    expect(addMissingVar(next, "dev", "tenant")[1]).toBe(next[1]);
  });
});

describe("setVarValue / revealKey", () => {
  it("changes one value only", () => {
    const envs = [env("a", [kv("1", "x", "old")]), env("b", [kv("1", "x", "keep")])];
    const next = setVarValue(envs, "a", "1", "new");
    expect(next[0].vars[0].value).toBe("new");
    expect(next[1]).toBe(envs[1]);
  });
  it("keys reveal per environment", () => {
    expect(revealKey("a", "1")).not.toBe(revealKey("b", "1"));
  });
});
