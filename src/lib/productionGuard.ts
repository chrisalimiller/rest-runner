import type { Environment } from "./environments";
import { isBoolean, load, save } from "./storage";

export const CONFIRM_PRODUCTION_KEY = "rest-runner.confirm-production";

/** "Confirm before sending requests to a production environment". On unless the user turned it off. */
export function loadConfirmProduction(): boolean {
  return load<boolean>(CONFIRM_PRODUCTION_KEY, true, isBoolean);
}

export function saveConfirmProduction(on: boolean): boolean {
  return save(CONFIRM_PRODUCTION_KEY, on);
}

/** Only the explicit flag counts; the environment's name and colour are never looked at. */
export function isProductionEnv(env: Environment | null | undefined): boolean {
  return env?.isProduction === true;
}

/**
 * The display name of the environment to confirm a send to, or null when no confirmation is needed
 * (setting off, no environment, or an environment not flagged as production).
 */
export function productionToConfirm(env: Environment | null | undefined, enabled: boolean): string | null {
  if (!enabled || !env || !isProductionEnv(env)) return null;
  return env.name.trim() || "(unnamed)";
}
