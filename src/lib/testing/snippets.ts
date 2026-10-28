export interface Snippet {
  label: string;
  code: string;
  phase: "pre" | "post" | "both";
}

export const SNIPPETS: Snippet[] = [
  { phase: "post", label: "Status is 200", code: `rr.test("Status is 200", () => {\n  rr.expect(rr.response.status).toBe(200);\n});` },
  { phase: "post", label: "Response time under 500 ms", code: `rr.test("Response time under 500 ms", () => {\n  rr.expect(rr.response.time).toBeLessThan(500);\n});` },
  {
    phase: "post",
    label: "JSON field has a value",
    code: `rr.test("Has an id", () => {\n  const body = rr.response.json();\n  rr.expect(body.id).toBeDefined();\n});`,
  },
  {
    phase: "post",
    label: "Save a JSON field to a variable",
    code: `// Later requests (and later cases in a test run) can use {{token}}\nrr.vars.set("token", rr.response.json().token);`,
  },
  { phase: "post", label: "Header contains", code: `rr.test("Returns JSON", () => {\n  rr.expect(rr.response.header("content-type")).toContain("json");\n});` },
  { phase: "post", label: "Log the response", code: `console.log(rr.response.status, rr.response.body);` },
  { phase: "pre", label: "Set a variable", code: `rr.vars.set("requestId", "req-" + Date.now());` },
  { phase: "pre", label: "Use a CSV value", code: `// rr.data holds this iteration's CSV row\nrr.vars.set("email", rr.data.username + "@example.com");` },
  { phase: "pre", label: "Random number", code: `rr.vars.set("n", String(Math.floor(Math.random() * 1000)));` },
  { phase: "both", label: "Read a variable", code: `const value = rr.vars.get("name");\nconsole.log("name is", value);` },
];

/** Names shown by autocomplete after "rr.". */
export const RR_COMPLETIONS: { label: string; detail: string; phase?: "pre" | "post" }[] = [
  { label: "rr.test", detail: '(name, () => { ... }) record a pass/fail check' },
  { label: "rr.expect", detail: "(value).toBe / toEqual / toContain / toBeLessThan / not…" },
  { label: "rr.vars.get", detail: "(name) run variable, CSV value or environment value" },
  { label: "rr.vars.set", detail: "(name, value) later requests, or later cases in this iteration, see it" },
  { label: "rr.vars.unset", detail: "(name)" },
  { label: "rr.vars.has", detail: "(name)" },
  { label: "rr.vars.all", detail: "() every variable as an object" },
  { label: "rr.data", detail: "this iteration's CSV row (read-only)" },
  { label: "rr.env", detail: "environment variables (read-only)" },
  { label: "rr.iteration", detail: "0-based iteration (CSV row) number" },
  { label: "rr.caseName", detail: "name of this test case or request" },
  { label: "rr.request", detail: "method, url, headers, body, header(name)" },
  { label: "rr.response.status", detail: "status code", phase: "post" },
  { label: "rr.response.statusText", detail: 'status text, e.g. "OK"', phase: "post" },
  { label: "rr.response.json", detail: "() parsed JSON body", phase: "post" },
  { label: "rr.response.text", detail: "() body as text", phase: "post" },
  { label: "rr.response.header", detail: "(name) header value, any case", phase: "post" },
  { label: "rr.response.time", detail: "response time in ms", phase: "post" },
  { label: "rr.response.size", detail: "body size in bytes", phase: "post" },
  { label: "rr.response.headers", detail: "[name, value][]", phase: "post" },
  { label: "rr.log", detail: "(...values) write to the case log" },
];
