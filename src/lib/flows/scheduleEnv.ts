import type { Environment } from "../environments";
import type { ScheduleNode } from "./types";

export interface ScheduleEnvironment {
  /** The environment the run uses; null for "No environment" or one that no longer exists. */
  env: Environment | null;
  /** The step has no pinned environment and follows the Flows top-bar switch. */
  follows: boolean;
  /** The step pins an environment that was deleted. */
  missing: boolean;
}

/** Which environment a scheduled run uses: the pinned one, or the Flows switch when none is pinned. */
export function scheduleEnvironment(node: Pick<ScheduleNode, "environmentId">, environments: Environment[], switchId: string | null): ScheduleEnvironment {
  if (node.environmentId === undefined) return { env: environments.find((e) => e.id === switchId) ?? null, follows: true, missing: false };
  if (node.environmentId === null) return { env: null, follows: false, missing: false };
  const env = environments.find((e) => e.id === node.environmentId) ?? null;
  return { env, follows: false, missing: !env };
}

/** The environment as text for chips and lists: its name, "No environment" or "Flows switch". */
export function scheduleEnvironmentText(r: ScheduleEnvironment): string {
  if (r.follows) return "Flows switch";
  if (r.missing) return "Environment deleted";
  return r.env ? r.env.name.trim() || "(unnamed)" : "No environment";
}
