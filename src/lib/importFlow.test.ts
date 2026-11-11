import { describe, expect, it } from "vitest";
import { newCollection, requestNode, type Collection } from "./collections";
import { newEnvironment, type Environment } from "./environments";
import { applyToAllClashes, canImport, computeImport, defaultChoice, resolutionsFor, scanText, uniqueName, type ImportChoice } from "./importFlow";
import { newRequest } from "./defaults";
import { toWorkspaceFile, type Workspace } from "./workspace";
import { newSuite } from "./testing/suites";
import { newFlow } from "./flows/flows";
import type { Flow } from "./flows/types";
import type { TestSuite } from "./testing/types";

const empty: Workspace = { collections: [], environments: [], suites: [], flows: [] };

/** A REST Runner workspace file as text. */
function wf(collections: Collection[] = [], environments: Environment[] = [], suites: TestSuite[] = [], flows: Flow[] = []): string {
  return toWorkspaceFile(collections, environments, { suites, flows });
}

const postmanCollection = {
  info: { name: "Shop", _postman_id: "abc", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [{ key: "baseUrl", value: "https://x" }, { key: "apiToken", value: "t" }],
  item: [{ name: "List", request: { method: "GET", url: "{{baseUrl}}/items" }, event: [{ listen: "test", script: { exec: ["pm.test('x', () => {})"] } }] }],
};

function env(name: string, vars: [string, string][]): Environment {
  return { ...newEnvironment(name), vars: vars.map(([key, value], i) => ({ id: `${name}-${i}`, key, value, enabled: true })) };
}

function pick(text: string, file = "f.json"): ImportChoice[] {
  return scanText(file, text).items.map(defaultChoice);
}

describe("scanText detection", () => {
  it("reads a Postman collection and offers its variables unchecked", () => {
    const s = scanText("shop.json", JSON.stringify(postmanCollection));
    expect(s.format).toBe("Postman collection");
    expect(s.items.map((i) => [i.kind, i.name, i.origin, i.defaultChecked])).toEqual([
      ["collection", "Shop", "file", true],
      ["environment", "Shop variables", "embedded", false],
    ]);
    expect(s.items[0].detail).toBe("1 request");
    expect(s.items[0].warnings.join(" ")).toMatch(/scripts/i);
  });
  it("leaves out the variables item when the collection has none", () => {
    const { variable, ...rest } = postmanCollection;
    void variable;
    expect(scanText("a.json", JSON.stringify(rest)).items).toHaveLength(1);
  });
  it("reads a Postman environment, checked, with secret type kept", () => {
    const s = scanText("dev.json", JSON.stringify({ id: "1", name: "Dev", values: [{ key: "a", value: "1", enabled: true }, { key: "p", value: "", type: "secret", enabled: true }] }));
    expect(s.format).toBe("Postman environment");
    expect(s.items[0]).toMatchObject({ kind: "environment", origin: "file", defaultChecked: true });
    expect(s.items[0].environment?.vars[1].secret).toBe(true);
  });
  it("reads Postman globals, unchecked", () => {
    const s = scanText("globals.json", JSON.stringify({ id: "g", name: "Workspace Globals", _postman_variable_scope: "globals", values: [{ key: "a", value: "1", enabled: true }] }));
    expect(s.format).toBe("Postman globals");
    expect(s.items[0]).toMatchObject({ origin: "globals", defaultChecked: false, name: "Workspace Globals" });
  });
  it("reads Insomnia, Bruno and .env", () => {
    const ins = scanText("i.json", JSON.stringify({ _type: "export", resources: [{ _id: "w", _type: "workspace", name: "W" }, { _id: "r", _type: "request", name: "R", method: "GET", url: "u", parentId: "w" }, { _id: "e", _type: "environment", name: "Base", parentId: "w", data: { a: "1" } }] }));
    expect(ins.items.map((i) => i.kind)).toEqual(["collection", "environment"]);
    expect(ins.items.every((i) => i.defaultChecked)).toBe(true);
    const bru = scanText("collection.json", JSON.stringify({ name: "B", version: "1", items: [{ type: "http-request", name: "r", request: { method: "GET", url: "u" } }], environments: [] }));
    expect(bru.format).toBe("Bruno collection");
    expect(scanText("local.bru", "vars {\n  a: 1\n}\n").format).toBe("Bruno environment");
    const dot = scanText(".env.staging", "A=1\nB=2");
    expect(dot.format).toBe(".env file");
    expect(dot.items[0]).toMatchObject({ name: "staging", detail: "2 variables" });
  });
  it("reads a REST Runner workspace with everything in it", () => {
    const col: Collection = { ...newCollection("Mine"), items: [requestNode(newRequest())] };
    const s = scanText("ws.json", wf([col], [env("Dev", [["a", "1"]])], [newSuite("S")], [newFlow("F")]));
    expect(s.items.map((i) => [i.kind, i.name])).toEqual([["collection", "Mine"], ["environment", "Dev"], ["suite", "S"], ["flow", "F"]]);
  });
  it("reports problems per file instead of throwing", () => {
    expect(scanText("e.json", "").error).toMatch(/empty/);
    expect(scanText("x.json", "{}").error).toMatch(/not a Postman/);
    expect(scanText("x.txt", "hello there").error).toMatch(/not a file/);
    expect(scanText("x.yaml", "type: collection.insomnia.rest/5.0\nname: x").error).toMatch(/YAML/);
    expect(scanText("x.json", wf()).error).toMatch(/nothing to import|no collections/);
  });
});

describe("computeImport", () => {
  const scanned = () => pick(JSON.stringify(postmanCollection));

  it("creates nothing unless checked", () => {
    const choices = scanned().map((c) => ({ ...c, checked: false }));
    const out = computeImport(empty, choices);
    expect(out.workspace).toEqual(empty);
    expect(canImport(choices, out)).toBe(false);
  });
  it("by default imports the collection and not its variables, with no environment created", () => {
    const choices = scanned();
    const out = computeImport(empty, choices);
    expect(out.workspace.collections.map((c) => c.name)).toEqual(["Shop"]);
    expect(out.workspace.environments).toEqual([]);
    expect(canImport(choices, out)).toBe(true);
    expect(out.counts).toEqual({ added: 1, merged: 0, replaced: 0 });
  });
  it("does not touch the current workspace", () => {
    const current: Workspace = { ...empty, environments: [env("Dev", [["a", "1"]])] };
    const snapshot = structuredClone(current);
    computeImport(current, pick(JSON.stringify({ id: "1", name: "Dev", values: [{ key: "b", value: "2" }] })).map((c) => ({ ...c, resolution: "replace" as const })));
    expect(current).toEqual(snapshot);
  });
  it("renames, flags production and marks secret-looking variables", () => {
    const choices = scanned().map((c) => (c.item.kind === "environment" ? { ...c, checked: true, name: "Shop prod", isProduction: true } : c));
    const out = computeImport(empty, choices);
    const e = out.workspace.environments[0];
    expect(e).toMatchObject({ name: "Shop prod", isProduction: true });
    expect(e.vars.map((v) => [v.key, !!v.secret])).toEqual([["baseUrl", false], ["apiToken", true]]);
  });
  it("leaves values alone when auto-marking is off, but Postman secrets stay secret", () => {
    const text = JSON.stringify({ name: "E", values: [{ key: "token", value: "t" }, { key: "other", value: "o", type: "secret" }] });
    const e = computeImport(empty, pick(text).map((c) => ({ ...c, markSecrets: false }))).workspace.environments[0];
    expect(e.vars.map((v) => !!v.secret)).toEqual([false, true]);
  });

  describe("name clashes", () => {
    const current: Workspace = { ...empty, environments: [env("Dev", [["host", "old"], ["keep", "k"]])] };
    const text = JSON.stringify({ name: "dev", values: [{ key: "host", value: "new" }, { key: "extra", value: "e" }, { key: "token", value: "", type: "secret" }] });

    it("flags a clash case-insensitively, with nothing preselected and the item held back", () => {
      const choices = pick(text);
      expect(choices[0].resolution).toBeNull();
      const out = computeImport(current, choices);
      expect(out.clashes).toEqual([true]);
      expect(out.unresolved).toBe(1);
      expect(canImport(choices, out)).toBe(false);
      expect(out.workspace.environments).toHaveLength(1);
    });
    it("a renamed item no longer clashes", () => {
      const out = computeImport(current, pick(text).map((c) => ({ ...c, name: "Dev 2" })));
      expect(out.clashes).toEqual([false]);
      expect(out.workspace.environments.map((e) => e.name)).toEqual(["Dev", "Dev 2"]);
    });
    it("keep both adds a suffixed copy with its own id", () => {
      const out = computeImport(current, pick(text).map((c) => ({ ...c, resolution: "keep-both" as const })));
      expect(out.workspace.environments.map((e) => e.name)).toEqual(["Dev", "dev (2)"]);
      expect(new Set(out.workspace.environments.map((e) => e.id)).size).toBe(2);
      expect(out.workspace.environments[0].vars[0].value).toBe("old");
    });
    it("merge updates same-named variables, adds new ones and keeps the rest", () => {
      const out = computeImport(current, pick(text).map((c) => ({ ...c, resolution: "merge" as const, isProduction: true })));
      const e = out.workspace.environments[0];
      expect(out.workspace.environments).toHaveLength(1);
      expect(e.name).toBe("Dev");
      expect(e.vars.map((v) => [v.key, v.value])).toEqual([["host", "new"], ["keep", "k"], ["extra", "e"], ["token", ""]]);
      expect(e.isProduction).toBe(true);
    });
    it("replace swaps the variables but keeps id and name, and a blank secret keeps the stored value", () => {
      const withSecret: Workspace = { ...empty, environments: [{ ...current.environments[0], vars: [{ id: "s", key: "token", value: "real", enabled: true, secret: true }] }] };
      const out = computeImport(withSecret, pick(text).map((c) => ({ ...c, resolution: "replace" as const })));
      const e = out.workspace.environments[0];
      expect(e.id).toBe(withSecret.environments[0].id);
      expect(e.name).toBe("Dev");
      expect(e.vars.map((v) => v.key)).toEqual(["host", "extra", "token"]);
      expect(e.vars.find((v) => v.key === "token")?.value).toBe("real");
    });
    it("never clears an existing production flag", () => {
      const prod: Workspace = { ...empty, environments: [{ ...current.environments[0], isProduction: true }] };
      const out = computeImport(prod, pick(text).map((c) => ({ ...c, resolution: "replace" as const, isProduction: false })));
      expect(out.workspace.environments[0].isProduction).toBe(true);
    });
    it("applies to all clashes only where the choice makes sense", () => {
      const ws: Workspace = { ...empty, environments: current.environments, suites: [newSuite("S")] };
      const choices = [...pick(text), ...pick(wf([], [], [newSuite("S")]), "s.json")];
      const first = computeImport(ws, choices);
      expect(first.clashes).toEqual([true, true]);
      const merged = applyToAllClashes(choices, first.clashes, "merge");
      expect(merged.map((c) => c.resolution)).toEqual(["merge", null]);
      const kept = applyToAllClashes(choices, first.clashes, "keep-both");
      expect(kept.map((c) => c.resolution)).toEqual(["keep-both", "keep-both"]);
      const out = computeImport(ws, kept);
      expect(out.unresolved).toBe(0);
      expect(out.workspace.suites.map((s) => s.name)).toEqual(["S", "S (2)"]);
    });
    it("two imported items with the same name clash with each other", () => {
      const a = pick(text, "a.json")[0];
      const b = pick(text, "b.json")[0];
      const out = computeImport(empty, [a, b]);
      expect(out.clashes).toEqual([false, true]);
      expect(out.unresolved).toBe(1);
      const kept = computeImport(empty, [a, { ...b, resolution: "keep-both" }]);
      expect(kept.workspace.environments.map((e) => e.name)).toEqual(["dev", "dev (2)"]);
    });
    it("unchecked items never clash", () => {
      const out = computeImport(current, pick(text).map((c) => ({ ...c, checked: false })));
      expect(out.clashes).toEqual([false]);
      expect(out.unresolved).toBe(0);
    });
  });

  describe("collections", () => {
    const existing = pick(JSON.stringify(postmanCollection))[0];
    const base = computeImport(empty, [existing]).workspace;

    it("keep both gives the copy fresh ids", () => {
      const out = computeImport(base, [{ ...existing, resolution: "keep-both" }]);
      expect(out.workspace.collections.map((c) => c.name)).toEqual(["Shop", "Shop (2)"]);
      const ids = out.workspace.collections.flatMap((c) => [c.id, ...c.items.map((i) => i.id)]);
      expect(new Set(ids).size).toBe(ids.length);
    });
    it("replace keeps the collection id", () => {
      const out = computeImport(base, [{ ...existing, resolution: "replace" }]);
      expect(out.workspace.collections).toHaveLength(1);
      expect(out.workspace.collections[0].id).toBe(base.collections[0].id);
    });
    it("merge adds new requests and updates matching ones in place", () => {
      const changed = {
        ...postmanCollection,
        item: [
          { name: "List", request: { method: "GET", url: "{{baseUrl}}/items", header: [{ key: "X", value: "1" }] } },
          { name: "Create", request: { method: "POST", url: "{{baseUrl}}/items" } },
        ],
      };
      const choice = { ...pick(JSON.stringify(changed))[0], resolution: "merge" as const };
      const out = computeImport(base, [choice]);
      const c = out.workspace.collections[0];
      expect(c.items).toHaveLength(2);
      const list = c.items[0];
      expect(list.id).toBe(base.collections[0].items[0].id);
      expect(list.kind === "request" && list.request.headers[0].key).toBe("X");
    });
    it("merge folds same-named folders together", () => {
      const withFolder = (names: string[]) => ({ ...postmanCollection, item: [{ name: "Dir", item: names.map((n) => ({ name: n, request: { method: "GET", url: `/${n}` } })) }] });
      const first = computeImport(empty, pick(JSON.stringify(withFolder(["a"])))).workspace;
      const out = computeImport(first, [{ ...pick(JSON.stringify(withFolder(["b"])))[0], resolution: "merge" }]);
      const dir = out.workspace.collections[0].items[0];
      expect(out.workspace.collections[0].items).toHaveLength(1);
      expect(dir.kind === "folder" && dir.items.length).toBe(2);
    });
    it("re-ids when an id already exists under another name", () => {
      const col = pick(wf([{ ...newCollection("A"), id: "same" }]))[0];
      const other: Workspace = { ...empty, collections: [{ ...newCollection("B"), id: "same" }] };
      const out = computeImport(other, [col]);
      expect(new Set(out.workspace.collections.map((c) => c.id)).size).toBe(2);
    });
  });

  it("collects warnings and summary lines for what was imported only", () => {
    const out = computeImport(empty, scanned());
    expect(out.lines[0]).toMatch(/Added collection "Shop"/);
    expect(out.warnings.join(" ")).toMatch(/scripts/i);
    const none = computeImport(empty, scanned().map((c) => ({ ...c, checked: false })));
    expect(none.warnings).toEqual([]);
  });
  it("certificates have no clash and are left to the caller", () => {
    const text = JSON.stringify({ app: "rest-runner", kind: "workspace", version: 4, collections: [], environments: [], certificates: [{ id: "c", host: "x" }] });
    const choices = pick(text);
    expect(choices.map((c) => c.item.kind)).toEqual(["certificates"]);
    const out = computeImport(empty, choices);
    expect(out.clashes).toEqual([false]);
    expect(canImport(choices, out)).toBe(true);
  });
});

describe("helpers", () => {
  it("uniqueName suffixes past taken names", () => {
    expect(uniqueName("A", new Set())).toBe("A");
    expect(uniqueName("A", new Set(["a"]))).toBe("A (2)");
    expect(uniqueName("A", new Set(["a", "a (2)"]))).toBe("A (3)");
  });
  it("only collections and environments can be merged", () => {
    expect(resolutionsFor("environment")).toContain("merge");
    expect(resolutionsFor("suite")).not.toContain("merge");
    expect(resolutionsFor("flow")).toEqual(["replace", "keep-both"]);
  });
});
