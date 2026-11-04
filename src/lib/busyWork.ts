/**
 * Which parts of the app are in the middle of a run (a batch, a test suite or a flow).
 * The update dialog reads this to ask before restarting, because a restart stops them.
 */
const busy = new Set<string>();

/** Marks `source` as running or finished. Each part of the app uses its own source name. */
export function setBusy(source: string, running: boolean): void {
  if (running) busy.add(source);
  else busy.delete(source);
}

export function isBusy(): boolean {
  return busy.size > 0;
}
