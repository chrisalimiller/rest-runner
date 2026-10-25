/// <reference types="node" />
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BATCH_OPTIONS } from "./batch";
import { parseCsv } from "./csv";
import { prepareRequest } from "./request";
import { buildScript, scriptExportNotes, scriptFileName, scriptRunCommand, type ScriptExportInput, type ScriptLanguage } from "./scriptExport";
import type { KeyValue, RequestDef } from "./types";

function has(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}
const python = has("python3", ["--version"]) ? "python3" : has("python", ["--version"]) ? "python" : null;
const bash = process.platform !== "win32" && has("bash", ["--version"]) ? "bash" : null;
const curl = has("curl", ["--version"]);
const LANGS: { lang: ScriptLanguage; cmd: string | null }[] = [
  { lang: "python", cmd: python },
  { lang: "bash", cmd: bash },
];

let n = 0;
const kv = (key: string, value: string, enabled = true): KeyValue => ({ id: `kv${n++}`, key, value, enabled });

function request(overrides: Partial<RequestDef>): RequestDef {
  return {
    id: "r1",
    name: "Create user",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    bodyMode: "none",
    body: "",
    formBody: [],
    auth: { type: "none" },
    ...overrides,
  };
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rr-script-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** What --dry-run prints, built with the app's own request code. */
function expectedDryRun(input: ScriptExportInput, csv: string): string {
  return parseCsv(csv)
    .rows.map((row, i) => {
      const p = prepareRequest(input.def, { ...input.defaults, ...row });
      const lines = [`${p.method} ${p.url}`, ...p.headers.map(([k, v]) => `${k}: ${v}`)];
      if (p.body) lines.push("", p.body);
      return `Row ${i + 1}\n${lines.join("\n")}\n\n`;
    })
    .join("");
}

function writeScript(lang: ScriptLanguage, input: ScriptExportInput, csv: string, csvName = "data.csv") {
  const sub = mkdtempSync(join(dir, `${lang}-`));
  const script = join(sub, scriptFileName(input.def, lang));
  writeFileSync(script, buildScript(lang, input));
  writeFileSync(join(sub, csvName), csv);
  return { sub, script };
}

const TRICKY_CSV =
  "﻿id;name;note;n;name\r\n" +
  '1;"Ann ""the cat"" O\'Brien";"line one\nline two\\ \t$(echo hi) `x` %s";42;dup\r\n' +
  "\r\n" +
  "2;Zoë 😀 & co;a=b&c?d#e;3.5\r\n" +
  '3;"semi;colon";back\\slash\\n;-1;x;extra\r\n';

const TRICKY_DEF = request({
  method: "POST",
  url: "{{ base }}/users/{{id}}?x=1",
  params: [kv("q", "{{name}}"), kv("off", "nope", false), kv(" note ", "{{note}} {{missing}}")],
  headers: [kv("X-Id", "{{id}}"), kv("X-Empty", "")],
  bodyMode: "json",
  body: '{"name": "{{name}}", "n": {{n}}, "note": "{{note}}", "env": "{{token}}", "literal": "\\"{{id}}\\"", "unknown": "{{nope}}"}',
  auth: { type: "basic", username: "{{name}}", password: "p@ss:{{id}}" },
});

const TRICKY_INPUT: ScriptExportInput = {
  def: TRICKY_DEF,
  options: DEFAULT_BATCH_OPTIONS,
  defaults: { base: "example.test", token: "t'o\"k$en", id: "ignored-because-csv-wins" },
  envName: "Dev",
  csvName: "data.csv",
};

const OTHER_DEFS: { label: string; def: RequestDef; csv: string }[] = [
  {
    label: "urlencoded form, bearer auth, comma CSV",
    def: request({
      method: "PUT",
      url: "https://api.test/items",
      bodyMode: "urlencoded",
      formBody: [kv("name", "{{name}}"), kv("tags", "a b+c")],
      auth: { type: "bearer", token: "{{tok}}" },
    }),
    csv: 'name,tok\n"Bob, Jr.",abc\n,\nÅsa,"x""y"\n',
  },
  {
    label: "text body, api key in query, tab CSV",
    def: request({
      method: "PATCH",
      url: "localhost:8080/a#frag",
      bodyMode: "text",
      body: "Hello {{who}}!\n{{ who }}",
      auth: { type: "apikey", key: "api_key", value: "{{key}}", addTo: "query" },
      headers: [kv("content-type", "text/csv")],
    }),
    csv: "who\tkey\nworld\ts3cr3t\n\"multi\nline\"\t\n",
  },
  {
    label: "GET with api key header and pipe CSV",
    def: request({
      url: "http://h/{{a}}",
      params: [kv("b", "{{b}}")],
      bodyMode: "json",
      body: '{"ignored": true}',
      auth: { type: "apikey", key: "X-Key", value: "{{b}}", addTo: "header" },
    }),
    csv: "a|b\n1|x y\n2|\n",
  },
];

describe("script export", () => {
  it("names files after the request", () => {
    expect(scriptFileName(request({ name: "Create user (v2)" }), "python")).toBe("create-user-v2-batch.py");
    expect(scriptFileName(request({ name: "" }), "bash")).toBe("request-batch.sh");
  });

  it("warns about request scripts and copied values", () => {
    const notes = scriptExportNotes({ ...TRICKY_INPUT, def: { ...TRICKY_DEF, preScript: "rr.vars.set('a', 1)" } });
    expect(notes[0]).toMatch(/pre-request script is JavaScript/);
    expect(notes[1]).toMatch(/Dev environment/);
    expect(scriptExportNotes({ ...TRICKY_INPUT, defaults: {} })).toEqual([]);
  });

  it("keeps the runner text out of the settings", () => {
    const text = buildScript("python", { ...TRICKY_INPUT, def: { ...TRICKY_DEF, name: "@@SETTINGS@@ test" } });
    expect(text).not.toMatch(/^@@SETTINGS@@$/m);
    expect(text).toContain('"name": "@@SETTINGS@@ test"');
  });

  for (const { lang, cmd } of LANGS) {
    describe(lang, () => {
      it.skipIf(!cmd)("builds the same requests as the app (dry run)", () => {
        const { sub, script } = writeScript(lang, TRICKY_INPUT, TRICKY_CSV);
        const out = execFileSync(cmd!, [script, "--dry-run"], { cwd: sub, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        expect(out).toBe(expectedDryRun(TRICKY_INPUT, TRICKY_CSV));
      });

      for (const { label, def, csv } of OTHER_DEFS) {
        it.skipIf(!cmd)(`builds the same requests as the app: ${label}`, () => {
          const input: ScriptExportInput = { def, options: DEFAULT_BATCH_OPTIONS, defaults: {} };
          const { sub, script } = writeScript(lang, input, csv);
          const out = execFileSync(cmd!, [script, "data.csv", "--dry-run"], { cwd: sub, encoding: "utf8" });
          expect(out).toBe(expectedDryRun(input, csv));
        });
      }

      it.skipIf(!cmd)("explains a missing CSV", () => {
        const input: ScriptExportInput = { def: TRICKY_DEF, options: DEFAULT_BATCH_OPTIONS, defaults: {} };
        const { sub, script } = writeScript(lang, input, "");
        const r = spawnSync(cmd!, [script], { cwd: sub, encoding: "utf8" });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/CSV/);
      });
    });
  }
});

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

describe.skipIf(!curl && !python)("script export against a server", () => {
  let server: Server;
  let port = 0;
  const received: Received[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        received.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
        if (req.url?.startsWith("/redirect")) {
          res.writeHead(302, { Location: "/users/redirected" });
          res.end();
          return;
        }
        const status = req.url?.includes("/users/2") ? 500 : 201;
        res.writeHead(status, { "Content-Type": "application/json", "X-Echo": req.headers["x-id"] ?? "" });
        res.end(JSON.stringify({ got: body ? JSON.parse(body) : null }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const csv = 'id,name\n1,"Ann ""A"""\n2,Bob\n3,Zoë\n';

  function run(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }

  for (const { lang, cmd } of LANGS) {
    it.skipIf(!cmd || (lang === "bash" && !curl))(`${lang}: sends every row and writes the results CSV`, async () => {
      received.length = 0;
      const def = request({
        method: "POST",
        url: `127.0.0.1:${port}/users/{{id}}`,
        headers: [kv("X-Id", "{{id}}")],
        bodyMode: "json",
        body: '{"name": "{{name}}", "token": "{{token}}"}',
      });
      const input: ScriptExportInput = { def, options: { ...DEFAULT_BATCH_OPTIONS, concurrency: 2 }, defaults: { token: "tok" } };
      const { sub, script } = writeScript(lang, input, csv);
      const r = await run(cmd!, [script, "data.csv", "--out", "out.csv"], sub);
      expect(r.code, r.stderr).toBe(1); // row 2 gets a 500
      expect(r.stdout).toMatch(/Finished: 3 of 3 sent, 2 passed, 1 failed/);

      const bodies = received.map((x) => JSON.parse(x.body)).sort((a, b) => a.name.localeCompare(b.name));
      expect(bodies).toEqual([
        { name: 'Ann "A"', token: "tok" },
        { name: "Bob", token: "tok" },
        { name: "Zoë", token: "tok" },
      ]);
      expect(received.every((x) => x.method === "POST" && x.headers["content-type"] === "application/json")).toBe(true);

      const report = parseCsv(readFileSync(join(sub, "out.csv"), "utf8"));
      expect(report.headers.slice(0, 4)).toEqual(["row", "result", "status", "status_text"]);
      expect(report.headers.slice(-2)).toEqual(["var:id", "var:name"]);
      expect(report.rows.map((x) => [x.row, x.result, x.status])).toEqual([
        ["1", "PASS", "201"],
        ["2", "FAIL", "500"],
        ["3", "PASS", "201"],
      ]);
      expect(report.rows[0].status_text).toBe("Created");
      expect(report.rows[0].response_body).toBe('{"got":{"name":"Ann \\"A\\"","token":"tok"}}');
      expect(report.rows[0].response_headers).toMatch(/x-echo: 1/i);
      expect(report.rows[0].request_body).toBe('{"name": "Ann \\"A\\"", "token": "tok"}');
      expect(report.rows[2]["var:name"]).toBe("Zoë");
    });

    it.skipIf(!cmd || (lang === "bash" && !curl))(`${lang}: stops after a failure and reports connection errors`, async () => {
      const def = request({ url: "http://127.0.0.1:1/{{id}}" });
      const input: ScriptExportInput = { def, options: { ...DEFAULT_BATCH_OPTIONS, concurrency: 1, stopOnFailure: true }, defaults: {} };
      const { sub, script } = writeScript(lang, input, csv);
      const r = await run(cmd!, [script, "data.csv", "--out", "out.csv"], sub);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/Stopped after a failure: 1 of 3 sent, 0 passed, 1 failed/);
      const report = parseCsv(readFileSync(join(sub, "out.csv"), "utf8"));
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0].status).toBe("ERR");
      expect(report.rows[0].error).not.toBe("");
    });

    it.skipIf(!cmd || (lang === "bash" && !curl))(`${lang}: follows redirects and keeps the final response`, async () => {
      received.length = 0;
      const def = request({ url: `http://127.0.0.1:${port}/redirect` });
      const input: ScriptExportInput = { def, options: DEFAULT_BATCH_OPTIONS, defaults: {} };
      const { sub, script } = writeScript(lang, input, "x\n1\n");
      const r = await run(cmd!, [script, "data.csv", "--out", "out.csv"], sub);
      expect(r.code, r.stderr).toBe(0);
      expect(received.map((x) => x.url)).toEqual(["/redirect", "/users/redirected"]);
      const report = parseCsv(readFileSync(join(sub, "out.csv"), "utf8"));
      expect(report.rows[0].status).toBe("201");
      expect(report.rows[0].response_headers).not.toMatch(/location/i);
    });
  }
});

describe("scriptRunCommand", () => {
  it("quotes file names with spaces and falls back to data.csv", () => {
    expect(scriptRunCommand("python", "a-batch.py", "people.csv")).toBe("python3 a-batch.py people.csv");
    expect(scriptRunCommand("bash", "my batch.sh", "my people.csv")).toBe('bash "my batch.sh" data.csv');
    expect(scriptRunCommand("python", "a.py", undefined, true)).toBe("py a.py data.csv");
  });
});
