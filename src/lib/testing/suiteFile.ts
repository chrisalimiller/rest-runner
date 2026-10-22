import { cleanSuites } from "./suites";
import type { TestSuite } from "./types";

/** File format for exporting and importing test suites. */
export interface SuitesFile {
  app: "rest-runner";
  kind: "test-suites";
  version: 1;
  exportedAt: string;
  suites: TestSuite[];
}

export function toSuitesFile(suites: TestSuite[]): string {
  const file: SuitesFile = { app: "rest-runner", kind: "test-suites", version: 1, exportedAt: new Date().toISOString(), suites };
  return JSON.stringify(file, null, 2);
}

/** Merges suites from an exported file. A suite with the same id is replaced; others are added. */
export function importSuitesFile(text: string, current: TestSuite[]): { suites: TestSuite[]; added: number; replaced: number } {
  let data: Partial<SuitesFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (data.app !== "rest-runner" || data.kind !== "test-suites") throw new Error("This is not a REST Runner test suites file.");
  const incoming = cleanSuites(data.suites);
  const suites = [...current];
  let added = 0;
  let replaced = 0;
  for (const s of incoming) {
    const i = suites.findIndex((x) => x.id === s.id);
    if (i === -1) {
      suites.push(s);
      added += 1;
    } else {
      suites[i] = s;
      replaced += 1;
    }
  }
  return { suites, added, replaced };
}
