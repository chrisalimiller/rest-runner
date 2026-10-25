/**
 * When Schedule steps come due. Times are the computer's local time. "Every N minutes"
 * counts from local midnight, so every 15 minutes means :00, :15, :30 and :45.
 */

export type Schedule =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string }
  /** days: 0 = Sunday … 6 = Saturday. */
  | { kind: "weekdays"; time: string; days: number[] };

export const DEFAULT_SCHEDULE: Schedule = { kind: "daily", time: "09:00" };

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MINUTE = 60_000;

/** Parses "HH:MM" to minutes after midnight, or null. */
export function parseTime(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** What is wrong with a schedule, or null. */
export function scheduleProblem(s: Schedule): string | null {
  if (s.kind === "interval") return Number.isFinite(s.minutes) && s.minutes >= 1 ? null : "Run at least once a minute: enter 1 or more minutes.";
  if (parseTime(s.time) === null) return "Enter a time as HH:MM, for example 09:30.";
  if (s.kind === "weekdays" && s.days.length === 0) return "Pick at least one day.";
  return null;
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function atMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
}

/** The latest due time at or before `t`, looking back at most 8 days. Null when there is none. */
export function lastDueAtOrBefore(s: Schedule, t: Date): Date | null {
  if (scheduleProblem(s)) return null;
  if (s.kind === "interval") {
    const step = Math.floor(s.minutes) * MINUTE;
    const day = midnight(t);
    const since = t.getTime() - day.getTime();
    const due = new Date(day.getTime() + Math.floor(since / step) * step);
    return due;
  }
  const minutes = parseTime(s.time)!;
  for (let back = 0; back <= 8; back++) {
    const day = new Date(t.getFullYear(), t.getMonth(), t.getDate() - back);
    if (s.kind === "weekdays" && !s.days.includes(day.getDay())) continue;
    const due = atMinutes(day, minutes);
    if (due.getTime() <= t.getTime()) return due;
  }
  return null;
}

/** The first due time after `t`. Null when the schedule is not valid. */
export function nextDueAfter(s: Schedule, t: Date): Date | null {
  if (scheduleProblem(s)) return null;
  if (s.kind === "interval") {
    const step = Math.floor(s.minutes) * MINUTE;
    const day = midnight(t);
    const since = t.getTime() - day.getTime();
    const next = new Date(day.getTime() + (Math.floor(since / step) + 1) * step);
    const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    // The count starts again at midnight.
    return next.getTime() > tomorrow.getTime() ? tomorrow : next;
  }
  const minutes = parseTime(s.time)!;
  for (let ahead = 0; ahead <= 8; ahead++) {
    const day = new Date(t.getFullYear(), t.getMonth(), t.getDate() + ahead);
    if (s.kind === "weekdays" && !s.days.includes(day.getDay())) continue;
    const due = atMinutes(day, minutes);
    if (due.getTime() > t.getTime()) return due;
  }
  return null;
}

export function describeSchedule(s: Schedule): string {
  if (s.kind === "interval") return s.minutes === 1 ? "Every minute" : `Every ${s.minutes} minutes`;
  if (s.kind === "daily") return `Daily at ${s.time}`;
  const days = [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return `${days.map((d) => WEEKDAY_NAMES[d]).join(", ") || "No days"} at ${s.time}`;
}

/** What the scheduler remembers about one Schedule step, saved between app sessions. */
export interface ScheduleState {
  /** The latest due time that was dealt with (run or skipped). */
  handledDue: string;
  /** The last time a run came due and was skipped, and why. */
  skipped?: { due: string; reason: string };
  /** The last due time that started a run. */
  ranDue?: string;
}

export type ScheduleDecision =
  | { action: "none" }
  /** First time this schedule is seen: remember now, don't run for a time that has already passed. */
  | { action: "init"; due: string }
  | { action: "run"; due: string }
  | { action: "skip"; due: string; reason: string };

/**
 * Decides what to do for one schedule at time `now`.
 * - appStartedAt: due times before the app started were missed while it was closed, and are skipped.
 * - busy: the same flow is still running, so a run that comes due is skipped.
 */
export function decide(s: Schedule, state: ScheduleState | undefined, now: Date, appStartedAt: Date, busy: boolean): ScheduleDecision {
  const due = lastDueAtOrBefore(s, now);
  if (!due) return { action: "none" };
  const iso = due.toISOString();
  if (!state) return { action: "init", due: iso };
  if (due.getTime() <= Date.parse(state.handledDue)) return { action: "none" };
  if (due.getTime() < appStartedAt.getTime()) return { action: "skip", due: iso, reason: "REST Runner was closed" };
  if (busy) return { action: "skip", due: iso, reason: "the previous run was still going" };
  return { action: "run", due: iso };
}
