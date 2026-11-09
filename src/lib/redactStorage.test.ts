import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rewriteStores } from "./idb";
import {
  findLiteralSecrets,
  HISTORY_KEY,
  installStorageRedaction,
  looksLikeLiteralSecret,
  MIN_SECRET_LENGTH,
  redactForStorage,
  redactRunForStorage,
  SCRIPT_VARS_KEY,
  scrubPersistedStores,
  TABS_KEY,
  uninstallStorageRedaction,
} from "./redactStorage";
import { SECRET_MASK } from "./secrets";
import { resetSecretStoreForTests, setSecrets } from "./secretStore";
import { cleanHistory } from "./history";
import { load, save } from "./storage";
import { loadTabs, serializeTabs, initialTabs } from "./requestTabs";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const S = "s3cr3t-Value&<x>";

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});
afterEach(() => uninstallStorageRedaction());

describe("redactForStorage", () => {
  it("masks each variant: plain, JSON-escaped, URL-encoded, HTML-escaped, CSV-quoted", () => {
    const secret = 'pa"ss&w<o>rd';
    const variants = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), "pa&quot;ss&amp;w&lt;o&gt;rd", 'pa""ss&w<o>rd'];
    for (const v of variants) {
      const out = redactForStorage({ body: `before ${v} after` }, [secret]);
      expect(out.body).toBe(`before ${SECRET_MASK} after`);
    }
  });

  it("skips secrets shorter than the minimum", () => {
    expect(MIN_SECRET_LENGTH).toBe(4);
    expect(redactForStorage({ a: "abc and abc" }, ["abc"])).toEqual({ a: "abc and abc" });
    expect(redactForStorage({ a: "abcd" }, ["abcd"])).toEqual({ a: SECRET_MASK });
  });

  it("walks nested objects and arrays, leaving keys, numbers and structure alone", () => {
    const input = { [S]: "key", list: [{ x: `v=${S}`, n: 1, b: true, z: null }, [S]], status: "ok" };
    const out = redactForStorage(input, [S]);
    expect(out).toEqual({ [S]: "key", list: [{ x: `v=${SECRET_MASK}`, n: 1, b: true, z: null }, [SECRET_MASK]], status: "ok" });
  });

  it("does not mutate its input and returns it when there are no secrets", () => {
    const input = { a: { b: [S] } };
    const copy = structuredClone(input);
    redactForStorage(input, [S]);
    expect(input).toEqual(copy);
    expect(redactForStorage(input, [])).toBe(input);
    expect(redactForStorage(input, ["ab"])).toBe(input);
  });

  it("keeps placeholders and structural fields", () => {
    const out = redactForStorage({ url: "https://x/{{token}}?k=hunter22", method: "hunter22", type: "hunter22" }, ["hunter22"]);
    expect(out.url).toBe(`https://x/{{token}}?k=${SECRET_MASK}`);
    expect(out.method).toBe("hunter22");
    expect(out.type).toBe("hunter22");
  });

  it("handles a 1 MB string quickly", () => {
    const big = ("lorem ipsum dolor sit amet " + S + " ").repeat(Math.ceil((1024 * 1024) / 40)).slice(0, 1024 * 1024);
    const t = Date.now();
    const out = redactForStorage({ body: big }, [S, "another-secret", "third-secret-1"]);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(out.body).not.toContain(S);
  });
});

const secretEntry = () => ({
  id: "h1",
  method: "GET",
  url: `https://api/x?token=${S}`,
  status: 200,
  sentAt: "2025-01-01T00:00:00.000Z",
  def: { id: "r", name: "n", method: "GET", url: "https://api/x?token={{tok}}", params: [], headers: [], bodyMode: "none", body: "", formBody: [], auth: { type: "none" } },
  response: { status: 200, statusText: "OK", headers: [["x", S]], body: `{"echo":"${S}"}`, sizeBytes: 10, durationMs: 5 },
  postScript: { logs: [`got ${S}`] },
});

describe("persistence boundaries", () => {
  it("history save stores redacted data, keeps def, and reloads", () => {
    installStorageRedaction();
    const entry = secretEntry();
    save(HISTORY_KEY, [entry]); // no secrets known yet: stored as is
    expect(localStorage.getItem(HISTORY_KEY)).toContain("s3cr3t");
    setSecrets("env1", { v1: S });
    try {
      expect(save(HISTORY_KEY, [entry])).toBe(true);
      const raw = localStorage.getItem(HISTORY_KEY)!;
      expect(raw).not.toContain("s3cr3t");
      expect(cleanHistory(JSON.parse(raw))[0].def.url).toBe("https://api/x?token={{tok}}");
      expect(entry.response.body).toContain("s3cr3t"); // the live object is untouched
    } finally {
      resetSecretStoreForTests();
    }
  });

  it("scrubbing rewrites stored history, keeps def and still parses", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([secretEntry()]));
    const n = await scrubPersistedStores([S]);
    expect(n).toBe(1);
    const raw = localStorage.getItem(HISTORY_KEY)!;
    expect(raw).not.toContain("s3cr3t");
    const entries = cleanHistory(JSON.parse(raw));
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe(`https://api/x?token=${SECRET_MASK}`);
    expect(entries[0].def.url).toBe("https://api/x?token={{tok}}");
    expect(entries[0].response?.body).toContain(SECRET_MASK);
  });

  it("tabs keep their requests and reload", async () => {
    const tabs = initialTabs();
    localStorage.setItem(TABS_KEY, JSON.stringify(serializeTabs(tabs)));
    const before = localStorage.getItem(TABS_KEY);
    expect(await scrubPersistedStores([S])).toBe(0);
    expect(localStorage.getItem(TABS_KEY)).toBe(before);
    expect(loadTabs(localStorage.getItem(TABS_KEY), null).tabs).toHaveLength(1);
  });

  it("tabs redact response-like fields if present", async () => {
    localStorage.setItem(TABS_KEY, JSON.stringify({ v: 1, activeId: "a", tabs: [{ id: "a", def: { url: S }, response: { body: S } }] }));
    await scrubPersistedStores([S]);
    const t = JSON.parse(localStorage.getItem(TABS_KEY)!);
    expect(t.tabs[0].def.url).toBe(S);
    expect(t.tabs[0].response.body).toBe(SECRET_MASK);
  });

  it("script vars: masks by key name and by known value, keeps other vars", async () => {
    localStorage.setItem(SCRIPT_VARS_KEY, JSON.stringify({ accessToken: "abc", Session_ID: "x", userId: "42", note: `has ${S} in it`, apikey: "", my_api_key: "k", other: "plain" }));
    await scrubPersistedStores([S]);
    expect(load<Record<string, string>>(SCRIPT_VARS_KEY, {})).toEqual({
      accessToken: SECRET_MASK,
      Session_ID: SECRET_MASK,
      userId: "42",
      note: `has ${SECRET_MASK} in it`,
      apikey: "",
      my_api_key: SECRET_MASK,
      other: "plain",
    });
  });

  it("save() of script vars goes through the installed transform", () => {
    installStorageRedaction();
    save(SCRIPT_VARS_KEY, { password: "hunter2", keep: "me" });
    expect(JSON.parse(localStorage.getItem(SCRIPT_VARS_KEY)!)).toEqual({ password: SECRET_MASK, keep: "me" });
  });

  it("saved runs use report redaction on the stored copy only", () => {
    const run = { id: "r1", status: "done", entries: [{ url: `u?${S}`, response: { body: S } }], vars: { [S]: S } };
    const out = redactRunForStorage(run, [S]);
    expect(JSON.stringify(out)).not.toContain("s3cr3t");
    expect(out.id).toBe("r1");
    expect(JSON.stringify(run)).toContain("s3cr3t");
  });
});

describe("scrubPersistedStores", () => {
  it("is idempotent and never deletes unparseable data", async () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([secretEntry()]));
    localStorage.setItem(TABS_KEY, "{not json");
    localStorage.setItem(SCRIPT_VARS_KEY, "null");
    expect(await scrubPersistedStores([S])).toBe(1);
    expect(await scrubPersistedStores([S])).toBe(0);
    expect(localStorage.getItem(TABS_KEY)).toBe("{not json");
    expect(localStorage.getItem(SCRIPT_VARS_KEY)).toBe("null");
  });

  it("does not throw when storage is unavailable", async () => {
    globalThis.localStorage = undefined as unknown as Storage;
    await expect(scrubPersistedStores([S])).resolves.toBe(0);
  });
});

describe("rewriteStores", () => {
  function fakeDb(data: Record<string, unknown[]>) {
    const req = <T>(v: T) => {
      const r: { result: T; onsuccess: (() => void) | null; onerror: null } = { result: v, onsuccess: null, onerror: null };
      setTimeout(() => r.onsuccess?.(), 0);
      return r;
    };
    return {
      objectStoreNames: { contains: (n: string) => n in data },
      transaction: (name: string) => {
        const tx: { oncomplete: (() => void) | null; onerror: null; onabort: null; objectStore: () => unknown } = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore: () => ({
            getAll: () => req(data[name].slice()),
            put: (v: { id: string }) => {
              data[name] = data[name].map((x) => ((x as { id: string }).id === v.id ? v : x));
              setTimeout(() => tx.oncomplete?.(), 0);
            },
          }),
        };
        return tx;
      },
    } as unknown as IDBDatabase;
  }

  it("rewrites changed records, counts them, and survives a throwing transform", async () => {
    const data = { runs: [{ id: "1", t: S }, { id: "2", t: "clean" }, { id: "3", t: "boom" }] };
    const db = fakeDb(data);
    const n = await rewriteStores(db, ["runs", "missing"], (r) => {
      if ((r as { id: string }).id === "3") throw new Error("x");
      return redactRunForStorage(r, [S]);
    });
    expect(n).toBe(1);
    expect(data.runs[0]).toEqual({ id: "1", t: SECRET_MASK });
    expect(data.runs[2]).toEqual({ id: "3", t: "boom" });
  });
});

describe("looksLikeLiteralSecret", () => {
  it.each([
    ["Authorization", "Bearer abc123", true],
    ["authorization", "Basic dXNlcjpwdw==", true],
    ["Authorization", "Bearer {{token}}", false],
    ["Authorization", "{{auth}}", false],
    ["Authorization", "", false],
    ["Proxy-Authorization", "Basic abc", true],
    ["Cookie", "sid=abc", true],
    ["Cookie", "{{cookie}}", false],
    ["X-API-Key", "k1234", true],
    ["X-API-Key", " {{key}} ", false],
    ["X-Auth-Token", "t0k", true],
    ["Client-Secret", "shh", true],
    ["Api-Key", "k", true],
    ["Content-Type", "application/json", false],
    ["Accept", "*/*", false],
    ["X-Token-Count", "5", false],
    ["X-Id", "abc{{x}}", false],
    ["X-Api-Key", "abc{{x}}", true],
  ])("%s: %s -> %s", (name, value, expected) => {
    expect(looksLikeLiteralSecret(name, value)).toBe(expected);
  });
});

describe("findLiteralSecrets", () => {
  it("reports field paths for headers and auth, skipping placeholders and disabled rows", () => {
    const found = findLiteralSecrets({
      headers: [
        { key: "Accept", value: "*/*", enabled: true },
        { key: "Authorization", value: "Bearer abc", enabled: true },
        { key: "X-API-Key", value: "{{k}}", enabled: true },
        { key: "Cookie", value: "a=b", enabled: false },
        { key: "X-Service-Token", value: "tok", enabled: true },
      ],
      auth: { type: "bearer", token: "abc" },
    });
    expect(found.map((f) => f.path)).toEqual(["headers[1].value", "headers[4].value", "auth.token"]);
  });

  it("covers basic password and api key value, ignores placeholders and none", () => {
    expect(findLiteralSecrets({ auth: { type: "basic", password: "pw" } }).map((f) => f.path)).toEqual(["auth.password"]);
    expect(findLiteralSecrets({ auth: { type: "apikey", key: "X-K", value: "v" } }).map((f) => f.path)).toEqual(["auth.value"]);
    expect(findLiteralSecrets({ auth: { type: "bearer", token: "{{t}}" } })).toEqual([]);
    expect(findLiteralSecrets({ auth: { type: "none" } })).toEqual([]);
    expect(findLiteralSecrets({})).toEqual([]);
  });
});
