import { beforeEach, describe, expect, it } from "vitest";
import { listPickableRequests } from "./requestSources";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

describe("listPickableRequests", () => {
  it("skips broken nodes in stored collections instead of throwing", () => {
    const request = { id: "r1", name: "Get", method: "GET", url: "u", params: [], headers: [] };
    store.set(
      "rest-runner.collections",
      JSON.stringify([
        null,
        { name: "C", items: "bad" },
        { name: "D", items: [null, 5, { kind: "request", request, examples: [null, { id: "e", name: "Ex", request }] }] },
      ]),
    );
    expect(listPickableRequests().map((p) => p.path.join("/"))).toEqual(["D/Get", "D/Get/Ex"]);
  });
});
