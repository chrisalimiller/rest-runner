import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("environment writes", () => {
  it("only environments.ts and secretsMigration.ts write rest-runner.environments", () => {
    const allowed = ["environments.ts", "secretsMigration.ts"];
    const bad = sources("src").filter((f) => {
      if (allowed.some((a) => f.endsWith(`/${a}`))) return false;
      const t = readFileSync(f, "utf8");
      return /save\(\s*ENVIRONMENTS_KEY/.test(t) || /(save|setItem)\(\s*["']rest-runner\.environments["']/.test(t) || /const\s+ENVIRONMENTS_KEY\s*=/.test(t);
    });
    expect(bad).toEqual([]);
  });
});
