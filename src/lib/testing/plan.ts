export interface PlanEstimate {
  /** Cases that will be sent: data rows × enabled cases × repeats. */
  total: number;
  text: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "36 cases planned (12 rows × 3 cases × 1 repeat)". With no CSV the rows part is left out. */
export function planEstimate(rows: number | null, enabledCases: number, repeat: number): PlanEstimate {
  const times = Math.max(1, Math.floor(repeat) || 1);
  const data = rows !== null && rows > 0 ? rows : null;
  const total = (data ?? 1) * enabledCases * times;
  const parts = [data !== null ? plural(data, "row") : null, plural(enabledCases, "case"), plural(times, "repeat")].filter(Boolean);
  return { total, text: `${plural(total, "case")} planned (${parts.join(" × ")})` };
}
