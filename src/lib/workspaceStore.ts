import { cleanCollections } from "./collections";
import { loadEnvironments, ENVIRONMENTS_KEY } from "./environments";
import { cleanFlows, FLOWS_KEY } from "./flows/flows";
import { load, save } from "./storage";
import { cleanSuites } from "./testing/suites";
import type { Workspace } from "./workspace";

const COLLECTIONS_KEY = "rest-runner.collections";
const SUITES_KEY = "rest-runner.test-suites";
export const ONBOARDED_KEY = "rest-runner.onboarded";

/** Everything the workspace file holds, as saved on this computer. */
export function readWorkspace(): Workspace {
  return {
    collections: cleanCollections(load(COLLECTIONS_KEY, [])),
    environments: loadEnvironments(),
    suites: cleanSuites(load(SUITES_KEY, [])),
    flows: cleanFlows(load(FLOWS_KEY, [])),
  };
}

/** Saves all four parts. Returns false when storage refused one of them. */
export function writeWorkspace(ws: Workspace): boolean {
  const results = [save(COLLECTIONS_KEY, ws.collections), save(ENVIRONMENTS_KEY, ws.environments), save(SUITES_KEY, ws.suites), save(FLOWS_KEY, ws.flows)];
  return results.every(Boolean);
}

/** True for a fresh install: nothing saved yet and the first-run screen has not been dealt with. */
export function isFirstRun(ws: Workspace = readWorkspace(), onboarded: boolean = load<boolean>(ONBOARDED_KEY, false)): boolean {
  return !onboarded && ws.collections.length === 0 && ws.suites.length === 0 && ws.flows.length === 0;
}

export function markOnboarded(): void {
  save(ONBOARDED_KEY, true);
}

/** Makes an environment the selected one in Requests, Testing and Flows; each mode reads it again on reload. */
export function selectEnvironmentEverywhere(id: string): void {
  for (const key of ["rest-runner.active-environment", "rest-runner.test-environment", "rest-runner.flow-environment"]) save(key, id);
}
