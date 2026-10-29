import { describe, expect, it } from "vitest";
import { requestToCurl } from "./curl";
import { detectDialect, looksLikeCurl, parseCurl, type CurlCommand, type CurlDialect } from "./curlImport";
import { newRequest } from "./defaults";
import type { KeyValue, RequestDef } from "./types";

function one(text: string, dialect?: CurlDialect): CurlCommand {
  const r = parseCurl(text, { dialect });
  if (!r.ok) throw new Error(`parse failed: ${r.error}`);
  const c = r.commands[0];
  if (!c.ok) throw new Error(`command failed: ${c.error}`);
  return c;
}

const filled = (rows: KeyValue[]) => rows.filter((r) => r.key !== "").map((r) => [r.key, r.value]);
const warns = (c: CurlCommand) => c.notes.filter((n) => n.level === "warn").map((n) => n.text);

describe("Chrome and Edge Copy as cURL", () => {
  const bashGet = `curl 'https://api.example.com/v1/items?limit=10&q=a%20b' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'authorization: Bearer abc.def.ghi' \\
  -b 'session=abc123; theme=dark' \\
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)' \\
  --compressed`;
  const cmdGet = `curl ^"https://api.example.com/v1/items?limit=10^&q=a%20b^" ^
  -H ^"accept: application/json, text/plain, */*^" ^
  -H ^"authorization: Bearer abc.def.ghi^" ^
  -H ^"cookie: session=abc123; theme=dark^" ^
  -H ^"user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)^" ^
  --compressed`;
  const bashPost = `curl 'https://api.example.com/v1/orders' \\
  -H 'content-type: application/json' \\
  --data-raw '{"id":42,"note":"a & b"}'`;
  const cmdPost = `curl ^"https://api.example.com/v1/orders^" ^
  -H ^"content-type: application/json^" ^
  --data-raw ^"^{^\\^"id^\\^":42,^\\^"note^\\^":^\\^"a ^& b^\\^"^}^"`;

  it.each([
    ["bash", bashGet],
    ["cmd", cmdGet],
  ] as const)("reads a GET with cookies (%s)", (dialect, text) => {
    expect(detectDialect(text)).toBe(dialect);
    const c = one(text);
    expect(c.def.method).toBe("GET");
    expect(c.def.url).toBe("https://api.example.com/v1/items");
    expect(filled(c.def.params)).toEqual([["limit", "10"], ["q", "a b"]]);
    expect(c.def.auth).toEqual({ type: "bearer", token: "abc.def.ghi" });
    expect(filled(c.def.headers).map(([k, v]) => [k.toLowerCase(), v])).toContainEqual(["cookie", "session=abc123; theme=dark"]);
    expect(filled(c.def.headers).some(([k]) => k === "authorization")).toBe(false);
    expect(c.def.name).toBe("GET items");
  });

  it.each([
    ["bash", bashPost],
    ["cmd", cmdPost],
  ] as const)("reads a POST with a JSON body (%s)", (dialect, text) => {
    expect(detectDialect(text)).toBe(dialect);
    const c = one(text);
    expect(c.def.method).toBe("POST");
    expect(c.def.bodyMode).toBe("json");
    expect(JSON.parse(c.def.body)).toEqual({ id: 42, note: "a & b" });
    expect(c.def.body).toContain("\n"); // pretty-printed
    expect(filled(c.def.headers)).toEqual([]); // the default JSON content type is not kept
    expect(c.summary).toBe("POST api.example.com/v1/orders · JSON body");
  });
});

describe("round trip with the exporter", () => {
  const row = (key: string, value: string): KeyValue => ({ id: key, key, value, enabled: true });
  const base = (p: Partial<RequestDef>): RequestDef => ({ ...newRequest(), url: "https://api.test/v1/things", ...p });
  const defs: [string, RequestDef][] = [
    ["plain GET", base({})],
    ["params and headers", base({ params: [row("a", "1"), row("b", "x y")], headers: [row("X-One", "1"), row("X-Empty", "")] })],
    ["json body", base({ method: "POST", bodyMode: "json", body: '{"a": [1, 2], "b": "it\'s"}' })],
    ["text body", base({ method: "PUT", bodyMode: "text", body: "line 'two' & more" })],
    ["urlencoded body", base({ method: "POST", bodyMode: "urlencoded", formBody: [row("k", "v w"), row("n", "1&2")] })],
    ["bearer", base({ auth: { type: "bearer", token: "tok.en" } })],
    ["basic", base({ auth: { type: "basic", username: "ann", password: "p:w d" } })],
    ["delete", base({ method: "DELETE" })],
  ];
  const norm = (d: RequestDef) => ({
    method: d.method,
    url: d.url,
    params: filled(d.params),
    headers: filled(d.headers).filter(([k]) => k !== "Content-Type"),
    auth: d.auth,
    bodyMode: d.bodyMode,
    body: d.bodyMode === "json" ? JSON.parse(d.body) : d.bodyMode === "urlencoded" ? filled(d.formBody) : d.body,
  });
  const expected = (d: RequestDef) => {
    const n = norm(d);
    // The exporter writes the query string into the URL, so params come back from there.
    return n;
  };

  for (const shell of ["bash", "cmd"] as const) {
    it.each(defs)(`${shell}: %s`, (_name, def) => {
      const command = requestToCurl(def, {}, shell).command;
      const c = one(command);
      const got = norm(c.def);
      const want = expected(def);
      // Anything with a body keeps its text; the cmd exporter puts JSON on one line, which is the same value.
      expect(got.method).toBe(want.method);
      expect(got.url).toBe(want.url);
      expect(got.params).toEqual(want.params);
      expect(got.headers).toEqual(want.headers);
      expect(got.auth).toEqual(want.auth);
      expect(got.bodyMode).toBe(want.bodyMode);
      expect(got.body).toEqual(want.body);
    });
  }
});

describe("quoting", () => {
  it("reads '\\'' inside single quotes", () => {
    const c = one(`curl https://a.test -H 'X-Name: it'\\''s'`);
    expect(filled(c.def.headers)).toEqual([["X-Name", "it's"]]);
  });

  it("reads $'…' with escapes", () => {
    const c = one(`curl https://a.test -X POST --data-raw $'{\\n"a":"it\\'s \\u00e9 \\x41"}'`);
    expect(c.def.body).toContain("it's é A");
  });

  it("reads double quotes with escapes and no variable expansion", () => {
    const c = one(`curl "https://a.test/x" -H "X-A: a \\"b\\" $HOME \\$x"`);
    expect(filled(c.def.headers)).toEqual([["X-A", 'a "b" $HOME $x']]);
  });

  it("reads cmd ^\" and ^&", () => {
    const c = one('curl ^"https://a.test/x?a=1^&b=2^" ^\n  -H ^"X-A: 1^"');
    expect(c.def.url).toBe("https://a.test/x");
    expect(filled(c.def.params)).toEqual([["a", "1"], ["b", "2"]]);
  });

  it("reads cmd double quotes with \\\" and \"\"", () => {
    const c = one('curl "https://a.test" -H "X-A: say \\"hi\\"" -H "X-B: say ""yo"""', "cmd");
    expect(filled(c.def.headers)).toEqual([["X-A", 'say "hi"'], ["X-B", 'say "yo"']]);
  });

  it("reads bundled short flags and attached values", () => {
    const a = one("curl -sSLX POST https://a.test");
    expect(a.def.method).toBe("POST");
    const b = one("curl -XPUT -HAccept:x https://a.test");
    expect(b.def.method).toBe("PUT");
    expect(filled(b.def.headers)).toEqual([["Accept", "x"]]);
  });

  it("reads --flag=value", () => {
    const c = one("curl --request=PATCH --header=X-A:1 --data=a=b https://a.test");
    expect(c.def.method).toBe("PATCH");
    expect(filled(c.def.headers)).toEqual([["X-A", "1"]]);
    expect(filled(c.def.formBody)).toEqual([["a", "b"]]);
  });

  it("strips a prompt and accepts curl.exe and CRLF", () => {
    const c = one("$ curl.exe https://a.test/x \\\r\n  -H 'A: 1'");
    expect(c.def.url).toBe("https://a.test/x");
    expect(filled(c.def.headers)).toEqual([["A", "1"]]);
  });
});

describe("several commands", () => {
  it("splits on curl lines and lists the lines between", () => {
    const r = parseCurl("export TOKEN=abc\n# first\ncurl https://a.test/one \\\n  -H 'A: 1'\n\ncurl -X POST https://a.test/two\n# done\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toHaveLength(2);
    expect(r.commands.map((c) => (c.ok ? c.def.url : ""))).toEqual(["https://a.test/one", "https://a.test/two"]);
    expect(r.commands.map((c) => c.line)).toEqual([3, 6]);
    expect(r.skipped).toEqual(["export TOKEN=abc", "# first", "# done"]);
  });
});

describe("errors", () => {
  it("names the line and column of an unclosed quote", () => {
    const r = parseCurl("curl https://a.test \\\n  -H 'X: 1");
    expect(r).toMatchObject({ ok: false, line: 2, column: 6 });
  });

  it("rejects an unsupported method for that command only", () => {
    const r = parseCurl("curl -X PROPFIND https://a.test\ncurl https://b.test");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands[0]).toMatchObject({ ok: false });
    expect(r.commands[0].ok === false && r.commands[0].error).toContain("PROPFIND");
    expect(r.commands[1]).toMatchObject({ ok: true });
  });

  it("says when there is no curl command", () => {
    expect(parseCurl("hello world")).toMatchObject({ ok: false, error: "No curl command found in this text." });
  });

  it("fails a command with no URL", () => {
    const r = parseCurl("curl -X POST");
    expect(r.ok && r.commands[0].ok).toBe(false);
  });

  it("looksLikeCurl", () => {
    expect(looksLikeCurl("curl https://a.test")).toBe(true);
    expect(looksLikeCurl("  $ curl.exe -I x")).toBe(true);
    expect(looksLikeCurl("curl")).toBe(false);
    expect(looksLikeCurl("curling https://a.test")).toBe(false);
    expect(looksLikeCurl("https://a.test")).toBe(false);
    expect(looksLikeCurl("# get it\nexport T=1\ncurl https://a.test")).toBe(true);
    expect(looksLikeCurl("# only a comment")).toBe(false);
  });
});

describe("flag mapping", () => {
  it("defaults the method from the data flags and -I", () => {
    expect(one("curl https://a.test").def.method).toBe("GET");
    expect(one("curl -d a=1 https://a.test").def.method).toBe("POST");
    expect(one("curl -I https://a.test").def.method).toBe("HEAD");
    expect(one("curl -G -d a=1 https://a.test").def.method).toBe("GET");
    expect(one("curl -x PUT https://a.test").def.method).toBe("GET"); // -x is the proxy
    expect(one("curl -X put https://a.test").def.method).toBe("PUT");
  });

  it("takes the first URL and warns about a second", () => {
    const c = one("curl https://a.test/1 https://a.test/2");
    expect(c.def.url).toBe("https://a.test/1");
    expect(warns(c)).toEqual(["More than one URL was given. Only the first is used."]);
  });

  it("splits the query string into params and drops the fragment", () => {
    const c = one("curl 'https://a.test/p?a=1&b&c=x%2By+z#frag'");
    expect(c.def.url).toBe("https://a.test/p");
    expect(filled(c.def.params)).toEqual([["a", "1"], ["b", ""], ["c", "x+y z"]]);
  });

  it("handles header edge cases", () => {
    const c = one("curl https://a.test -H 'X-Empty;' -H 'X-Gone:' -H 'X-Ok:  v '");
    expect(filled(c.def.headers)).toEqual([["X-Empty", ""], ["X-Ok", "v"]]);
    expect(c.notes.find((n) => n.level === "info")?.text).toContain("X-Gone");
    expect(warns(c)).toEqual([]);
  });

  it("reads Basic from a header and from -u", () => {
    const h = one(`curl https://a.test -H 'Authorization: Basic ${btoa("ann:p:w")}'`);
    expect(h.def.auth).toEqual({ type: "basic", username: "ann", password: "p:w" });
    const bad = one("curl https://a.test -H 'Authorization: Basic !!!'");
    expect(bad.def.auth).toEqual({ type: "none" });
    expect(filled(bad.def.headers)).toEqual([["Authorization", "Basic !!!"]]);
    const u = one("curl -u ann:secret https://a.test");
    expect(u.def.auth).toEqual({ type: "basic", username: "ann", password: "secret" });
    const nopass = one("curl -u ann https://a.test");
    expect(nopass.def.auth).toEqual({ type: "basic", username: "ann", password: "" });
    expect(nopass.notes[0].level).toBe("info");
  });

  it("warns that other auth schemes are not supported", () => {
    const c = one("curl --digest -u a:b https://a.test");
    expect(warns(c)).toEqual(["Authentication with --digest isn't supported. The request has no auth set."]);
  });

  it("joins several -d with & and strips line breaks from -d only", () => {
    const c = one("curl -d a=1 -d 'b=2' https://a.test");
    expect(filled(c.def.formBody)).toEqual([["a", "1"], ["b", "2"]]);
    expect(c.def.bodyMode).toBe("urlencoded");
    const t = one("curl -d $'x\\ny' https://a.test");
    expect(t.def.body).toBe("xy");
    const raw = one("curl --data-raw $'x\\ny' https://a.test");
    expect(raw.def.body).toBe("x\ny");
  });

  it("warns about file bodies, except for --data-raw", () => {
    const c = one("curl -d @payload.json https://a.test");
    expect(c.def.body).toBe("");
    expect(c.def.bodyMode).toBe("none");
    expect(warns(c)).toEqual(["File bodies aren't supported: the body read from a file was left empty."]);
    expect(one("curl --data-raw @payload.json https://a.test").def.body).toBe("@payload.json");
  });

  it("reads --data-urlencode", () => {
    const c = one("curl --data-urlencode 'q=a b&c' --data-urlencode 'x@file.txt' https://a.test");
    expect(c.def.bodyMode).toBe("urlencoded");
    expect(filled(c.def.formBody)).toEqual([["q", "a b&c"]]);
    expect(warns(c)).toEqual(["A --data-urlencode value read from a file was left out."]);
  });

  it("reads --json", () => {
    const c = one(`curl --json '{"a":1}' https://a.test`);
    expect(c.def.method).toBe("POST");
    expect(c.def.bodyMode).toBe("json");
    expect(filled(c.def.headers)).toEqual([["Accept", "application/json"]]);
  });

  it("turns -F text fields into an urlencoded body and warns", () => {
    const c = one("curl -F a=1 -F 'f=@pic.png' -F 'b=two;type=text/plain' https://a.test");
    expect(c.def.bodyMode).toBe("urlencoded");
    expect(filled(c.def.formBody)).toEqual([["a", "1"], ["b", "two"]]);
    expect(warns(c)).toEqual([
      "The form field \"f\" uploads a file, which isn't supported, so it was left out.",
      "A multipart form (-F) was turned into an urlencoded form body. Servers that need multipart won't accept it.",
    ]);
  });

  it("-G moves data into the query", () => {
    const c = one("curl -G -d a=1 -d 'b=x y' --data-urlencode 'c=z' https://a.test/s?q=0");
    expect(c.def.method).toBe("GET");
    expect(filled(c.def.params)).toEqual([["q", "0"], ["a", "1"], ["b", "x y"], ["c", "z"]]);
    expect(c.def.bodyMode).toBe("none");
  });

  it("reads cookies, user agent and referer", () => {
    const c = one("curl -b 'a=1' -A 'agent/1' -e https://ref.test https://a.test");
    expect(filled(c.def.headers)).toEqual([["Cookie", "a=1"], ["User-Agent", "agent/1"], ["Referer", "https://ref.test"]]);
    const jar = one("curl -b cookies.txt https://a.test");
    expect(warns(jar)).toEqual(["A cookie jar file was given instead of cookies, so it was left out."]);
  });

  it("warns for certificate, insecure and unsupported options and ignores the quiet ones", () => {
    expect(warns(one("curl -k https://a.test"))).toEqual(["REST Runner always checks certificates. Add the server's CA under Certificates instead of skipping the check."]);
    expect(warns(one("curl --cert c.pem --key k.pem --cacert ca.pem https://a.test"))).toEqual(["Certificates are set up under Certificates, not on each request."]);
    expect(warns(one("curl -x http://proxy:3128 -o out.txt https://a.test"))).toEqual(["--proxy isn't supported, so it was ignored.", "--output isn't supported, so it was ignored."]);
    const quiet = one("curl --compressed -s -S -v -L -i --http1.1 -m 5 --retry 3 -w '%{http_code}' -f https://a.test");
    expect(quiet.notes).toEqual([]);
    expect(quiet.def.url).toBe("https://a.test");
    expect(warns(one("curl --bogus https://a.test"))).toEqual(["The option --bogus isn't recognised, so it was ignored."]);
  });

  it("keeps a body on GET and warns it won't be sent", () => {
    const c = one("curl -X GET -d a=1 https://a.test");
    expect(c.def.method).toBe("GET");
    expect(c.def.formBody[0].key).toBe("a");
    expect(warns(c)).toEqual(["A GET request doesn't send a body, so the body is kept in the editor but won't be sent."]);
  });
});

describe("body mode", () => {
  it("detects JSON from the body or the content type", () => {
    expect(one(`curl -d '{"a":1}' https://a.test`).def.bodyMode).toBe("json");
    expect(one(`curl -d '[1]' https://a.test`).def.bodyMode).toBe("json");
    expect(one(`curl -H 'Content-Type: application/json' -d '{oops' https://a.test`).def.bodyMode).toBe("json");
    expect(one(`curl -d '5' https://a.test`).def.bodyMode).toBe("text");
  });

  it("detects form bodies from the content type or the shape", () => {
    const c = one(`curl -H 'Content-Type: application/x-www-form-urlencoded' --data-raw 'a=1&b=x%20y' https://a.test`);
    expect(c.def.bodyMode).toBe("urlencoded");
    expect(filled(c.def.formBody)).toEqual([["a", "1"], ["b", "x y"]]);
    expect(filled(c.def.headers)).toEqual([]);
  });

  it("keeps other content types and adds the form one curl would send", () => {
    const xml = one(`curl -H 'Content-Type: application/xml' -d '<a/>' https://a.test`);
    expect(xml.def.bodyMode).toBe("text");
    expect(filled(xml.def.headers)).toEqual([["Content-Type", "application/xml"]]);
    const plain = one(`curl -d 'hello world' https://a.test`);
    expect(plain.def.bodyMode).toBe("text");
    expect(filled(plain.def.headers)).toEqual([["Content-Type", "application/x-www-form-urlencoded"]]);
  });

  it("leaves a custom JSON content type", () => {
    const c = one(`curl -H 'Content-Type: application/vnd.api+json' -d '{"a":1}' https://a.test`);
    expect(filled(c.def.headers)).toEqual([["Content-Type", "application/vnd.api+json"]]);
  });
});

describe("the request that comes out", () => {
  it("ends every row list with one empty row and names the request", () => {
    const c = one("curl -X POST https://api.test/v1/orders/42/");
    for (const rows of [c.def.params, c.def.headers, c.def.formBody]) {
      expect(rows).toHaveLength(1);
      expect(rows[0].key).toBe("");
    }
    expect(c.def.name).toBe("POST 42");
    expect(one("curl https://api.test/").def.name).toBe("GET api.test");
    expect(one("curl https://api.test/a%20b").def.name).toBe("GET a b");
    expect(one("curl {{baseUrl}}/items").def.name).toBe("GET items");
  });
});
