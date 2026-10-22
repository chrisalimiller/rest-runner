import { describe, expect, it } from "vitest";
import { detectVarSets } from "./varsDetect";

describe("detectVarSets", () => {
  it("finds names and value expressions", () => {
    expect(detectVarSets(`rr.vars.set("ticketId", rr.response.json().id);\nrr.vars.set('token', body.access_token)`)).toEqual([
      { name: "ticketId", expression: "rr.response.json().id" },
      { name: "token", expression: "body.access_token" },
    ]);
  });

  it("handles nested calls, strings with commas and brackets, and line breaks", () => {
    expect(detectVarSets(`rr.vars.set("n", String(Math.floor(Math.random() * 1000)));`)).toEqual([{ name: "n", expression: "String(Math.floor(Math.random() * 1000))" }]);
    expect(detectVarSets(`rr.vars.set("a", "x, (y)")`)).toEqual([{ name: "a", expression: '"x, (y)"' }]);
    expect(detectVarSets(`rr.vars.set(\n  "id",\n  items[0].id\n);`)).toEqual([{ name: "id", expression: "items[0].id" }]);
  });

  it("skips comments, dynamic names and repeats", () => {
    const script = `// rr.vars.set("old", 1)\n/* rr.vars.set("older", 2) */\nrr.vars.set(name, 3);\nrr.vars.set(\`k\${i}\`, 4);\nrr.vars.set("id", 5);\nrr.vars.set("id", 6);`;
    expect(detectVarSets(script)).toEqual([{ name: "id", expression: "5" }]);
  });

  it("ignores get, unset and unrelated set calls", () => {
    expect(detectVarSets(`rr.vars.get("a"); rr.vars.unset("b"); map.set("c", 1);`)).toEqual([]);
    expect(detectVarSets("")).toEqual([]);
  });

  it("does not trip on // inside strings", () => {
    expect(detectVarSets(`rr.vars.set("url", "https://a.com/x");`)).toEqual([{ name: "url", expression: '"https://a.com/x"' }]);
  });
});
