/**
 * Lets a section ask before the app leaves it. A section with unsaved edits registers a guard under its own name;
 * the shell calls guardLeave before switching away. The guard either lets the switch go ahead (returns true) or
 * shows its own question and calls `proceed` later if the person agrees (returns false).
 */
export type LeaveGuard = (proceed: () => void) => boolean;

const guards = new Map<string, LeaveGuard>();

/** Registers (or with null removes) the guard for a section. */
export function setLeaveGuard(source: string, guard: LeaveGuard | null): void {
  if (guard) guards.set(source, guard);
  else guards.delete(source);
}

/** Runs `proceed` now, or after the section's guard has asked and been told to go ahead. */
export function guardLeave(source: string, proceed: () => void): void {
  const guard = guards.get(source);
  if (!guard || guard(proceed)) proceed();
}

/** Whether any section has a guard (for the window-closing warning). */
export function hasLeaveGuards(): boolean {
  return guards.size > 0;
}
