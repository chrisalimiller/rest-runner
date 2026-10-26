import { useEffect, useState } from "react";
import { loopProgress, runningLine } from "../../lib/flows/progress";
import type { Flow } from "../../lib/flows/types";
import type { FlowRunView } from "./FlowRunPanel";

/** "Running · Loop row 2 of 3 · 8.1 s", next to Stop. */
export function RunningLine({ flow, run }: { flow: Flow; run: FlowRunView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="flow-running-line">
      <span className="pulse-dot" aria-hidden />
      {runningLine(loopProgress(flow, run.steps, run.runningNodeIds), now - run.startedAt)}
    </span>
  );
}
