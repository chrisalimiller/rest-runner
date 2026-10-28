export interface PlanEstimate {
  /** Cases that will be sent: data rows × enabled cases × repeats. */
  total: number;
  text: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The most times a suite can repeat (Run settings allow 1 to this). */
export const MAX_REPEAT = 1000;

/** A repeat count from the settings or an imported file, as a whole number from 1 to MAX_REPEAT. */
export function clampRepeat(repeat: unknown): number {
  const n = Math.floor(Number(repeat));
  return Number.isFinite(n) ? Math.min(MAX_REPEAT, Math.max(1, n)) : 1;
}

/** "36 cases planned (12 rows × 3 cases × 1 repeat)". With no CSV the rows part is left out. */
export function planEstimate(rows: number | null, enabledCases: number, repeat: number): PlanEstimate {
  const times = clampRepeat(repeat);
  const data = rows !== null && rows > 0 ? rows : null;
  const total = (data ?? 1) * enabledCases * times;
  const parts = [data !== null ? plural(data, "row") : null, plural(enabledCases, "case"), plural(times, "repeat")].filter(Boolean);
  return { total, text: `${plural(total, "case")} planned (${parts.join(" × ")})` };
}
