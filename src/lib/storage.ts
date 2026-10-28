/**
 * localStorage helpers that never throw (storage can be unavailable).
 *
 * A stored value can be valid JSON of the wrong shape (hand-edited, or written by an older
 * or newer version), so `load` takes an optional check: a value that fails it, and a stored
 * `null`, give the fallback instead of reaching the UI and blanking it.
 */
export function load<T>(key: string, fallback: T, valid?: (x: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value: unknown = JSON.parse(raw);
    if (value === null || (valid && !valid(value))) return fallback;
    return value as T;
  } catch {
    return fallback;
  }
}

/** Returns false when storage refused the value (for example when it is full). */
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const isString = (x: unknown): x is string => typeof x === "string";
export const isBoolean = (x: unknown): x is boolean => typeof x === "boolean";
export const isArray = (x: unknown): x is unknown[] => Array.isArray(x);
export const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isString);
export const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** An object whose values are all strings, such as script variables. */
export const isStringRecord = (x: unknown): x is Record<string, string> => isPlainObject(x) && Object.values(x).every(isString);

/**
 * Keys that only remember how the screen looked (open sections, column split, what was open).
 * The crash screen offers to clear these; saved data (collections, environments, suites, flows,
 * history, runs) is never touched by it.
 */
export const VIEW_STATE_KEYS = [
  "rest-runner.draft",
  "rest-runner.expanded",
  "rest-runner.request-sections",
  "rest-runner.case-request-sections",
  "rest-runner.request-details",
  "rest-runner.case-request-details",
  "rest-runner.split",
  "rest-runner.section",
  "rest-runner.active-environment",
  "rest-runner.test-open-suite",
  "rest-runner.test-environment",
  "rest-runner.flow-open",
  "rest-runner.flow-environment",
  "rest-runner.curl-open",
  "rest-runner.flows-nav-collapsed",
  "rest-runner.testing-nav-collapsed",
];

export function clearViewState(): void {
  for (const key of VIEW_STATE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable: nothing to clear.
    }
  }
}
