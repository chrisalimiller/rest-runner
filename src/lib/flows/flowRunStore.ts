import { done, FLOW_RUNS, FLOW_SUMMARIES, openDb, result } from "../testing/testRunStore";
import type { FlowRun, FlowRunSummary } from "./types";

/** Flow runs live next to test runs in IndexedDB. Oldest are removed past this count. */
export const MAX_SAVED_FLOW_RUNS = 50;

export function flowRunSummary(run: FlowRun): FlowRunSummary {
  const { flow: _f, stepList: _s, vars: _v, log: _l, ...summary } = run;
  return summary;
}

/** Newest first. */
export async function listFlowRuns(): Promise<FlowRunSummary[]> {
  const db = await openDb();
  const all = await result(db.transaction(FLOW_SUMMARIES).objectStore(FLOW_SUMMARIES).getAll() as IDBRequest<FlowRunSummary[]>);
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getFlowRun(id: string): Promise<FlowRun | undefined> {
  const db = await openDb();
  return result(db.transaction(FLOW_RUNS).objectStore(FLOW_RUNS).get(id) as IDBRequest<FlowRun | undefined>);
}

export async function deleteFlowRun(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FLOW_SUMMARIES, FLOW_RUNS], "readwrite");
  tx.objectStore(FLOW_SUMMARIES).delete(id);
  tx.objectStore(FLOW_RUNS).delete(id);
  await done(tx);
}

export async function saveFlowRun(run: FlowRun): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([FLOW_SUMMARIES, FLOW_RUNS], "readwrite");
  tx.objectStore(FLOW_SUMMARIES).put(flowRunSummary(run));
  tx.objectStore(FLOW_RUNS).put(run);
  await done(tx);
  const runs = await listFlowRuns();
  for (const old of runs.slice(MAX_SAVED_FLOW_RUNS)) await deleteFlowRun(old.id);
}
