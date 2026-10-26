import { describe, expect, it } from "vitest";
import { cleanEnvironments, defaultEnvColor, guardFor, newEnvironment } from "./environments";
import { importWorkspaceFile } from "./workspace";

describe("environment colours", () => {
  it("makes Prod, Production and PRD red by default, in any case", () => {
    for (const name of ["Prod", "prod", " Production ", "PRD"]) expect(defaultEnvColor(name)).toBe("red");
    for (const name of ["Dev", "SIT", "Preprod", "Products", ""]) expect(defaultEnvColor(name)).toBe("none");
  });

  it("gives a new environment its default colour", () => {
    expect(newEnvironment("Prod").color).toBe("red");
    expect(newEnvironment("Dev").color).toBe("none");
  });

  it("loads older environments without a colour using the default for their name", () => {
    const old = [
      { id: "1", name: "Prod", vars: [] },
      { id: "2", name: "Dev", vars: [] },
      { id: "3", name: "Prod", vars: [], color: "none" },
      { id: "4", name: "QA", vars: [], color: "sparkly" },
      { id: "5", name: "Stage", vars: [], color: "amber" },
      { nope: true },
    ];
    expect(cleanEnvironments(old).map((e) => [e.id, e.color])).toEqual([
      ["1", "red"],
      ["2", "none"],
      ["3", "none"],
      ["4", "none"],
      ["5", "amber"],
    ]);
    expect(cleanEnvironments("x")).toEqual([]);
  });

  it("applies the default colour to imported environments", () => {
    const file = { app: "rest-runner", version: 2, collections: [], environments: [{ id: "e", name: "Production", vars: [] }] };
    expect(importWorkspaceFile(JSON.stringify(file), [], []).environments[0].color).toBe("red");
  });

  it("words the guarded buttons with the environment name, and only for coloured environments", () => {
    expect(guardFor({ ...newEnvironment("Prod") })).toMatchObject({ send: "Send to Prod", runSuite: "Run suite on Prod", run: "Run on Prod", color: "red" });
    expect(guardFor(newEnvironment("Dev"))).toBeNull();
    expect(guardFor(null)).toBeNull();
    expect(guardFor({ ...newEnvironment("SIT"), color: "blue" })?.send).toBe("Send to SIT");
  });
});
