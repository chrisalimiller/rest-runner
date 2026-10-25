import { describe, expect, it } from "vitest";
import { decide, describeSchedule, lastDueAtOrBefore, nextDueAfter, scheduleProblem, type Schedule } from "./schedule";

const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo - 1, d, h, mi, s);
// 2026-10-26 is a Monday.
const monday = (h: number, mi: number, s = 0) => at(2026, 10, 26, h, mi, s);

describe("due times", () => {
  it("counts intervals from local midnight", () => {
    const s: Schedule = { kind: "interval", minutes: 15 };
    expect(lastDueAtOrBefore(s, monday(10, 37))).toEqual(monday(10, 30));
    expect(lastDueAtOrBefore(s, monday(10, 30))).toEqual(monday(10, 30));
    expect(nextDueAfter(s, monday(10, 30))).toEqual(monday(10, 45));
    // 7 hours doesn't divide a day: the count starts again at midnight.
    const seven: Schedule = { kind: "interval", minutes: 420 };
    expect(nextDueAfter(seven, monday(22, 0))).toEqual(at(2026, 10, 27, 0, 0));
  });

  it("finds daily times today or on an earlier day", () => {
    const s: Schedule = { kind: "daily", time: "09:30" };
    expect(lastDueAtOrBefore(s, monday(10, 0))).toEqual(monday(9, 30));
    expect(lastDueAtOrBefore(s, monday(9, 0))).toEqual(at(2026, 10, 25, 9, 30));
    expect(nextDueAfter(s, monday(9, 30))).toEqual(at(2026, 10, 27, 9, 30));
  });

  it("only uses the chosen weekdays", () => {
    const s: Schedule = { kind: "weekdays", time: "08:00", days: [1, 3] }; // Mon, Wed
    expect(lastDueAtOrBefore(s, monday(7, 0))).toEqual(at(2026, 10, 21, 8, 0)); // the Wednesday before
    expect(nextDueAfter(s, monday(8, 0))).toEqual(at(2026, 10, 28, 8, 0));
    expect(describeSchedule(s)).toBe("Mon, Wed at 08:00");
  });

  it("explains bad schedules", () => {
    expect(scheduleProblem({ kind: "daily", time: "25:00" })).toMatch(/HH:MM/);
    expect(scheduleProblem({ kind: "weekdays", time: "08:00", days: [] })).toMatch(/at least one day/);
    expect(scheduleProblem({ kind: "interval", minutes: 0 })).toMatch(/1 or more/);
    expect(lastDueAtOrBefore({ kind: "daily", time: "nope" }, monday(9, 0))).toBeNull();
  });
});

describe("decide", () => {
  const s: Schedule = { kind: "daily", time: "09:00" };
  const started = monday(8, 0);

  it("remembers a new schedule without running a time that already passed", () => {
    expect(decide(s, undefined, monday(10, 0), started, false)).toEqual({ action: "init", due: monday(9, 0).toISOString() });
  });

  it("runs when a due time arrives while the app is open", () => {
    const state = { handledDue: at(2026, 10, 25, 9, 0).toISOString() };
    expect(decide(s, state, monday(9, 0, 20), started, false)).toEqual({ action: "run", due: monday(9, 0).toISOString() });
    expect(decide(s, { handledDue: monday(9, 0).toISOString() }, monday(9, 5), started, false)).toEqual({ action: "none" });
  });

  it("skips a run that came due while the app was closed", () => {
    const state = { handledDue: at(2026, 10, 25, 9, 0).toISOString() };
    expect(decide(s, state, monday(10, 0), monday(9, 45), false)).toEqual({ action: "skip", due: monday(9, 0).toISOString(), reason: "REST Runner was closed" });
  });

  it("skips a run while the flow is still running", () => {
    const state = { handledDue: at(2026, 10, 25, 9, 0).toISOString() };
    expect(decide(s, state, monday(9, 0, 10), started, true)).toMatchObject({ action: "skip", reason: "the previous run was still going" });
  });
});
