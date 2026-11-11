import { useSyncExternalStore } from "react";
import type { SessionState, ToolSession } from "../../lib/tools/session";

/** The current state of a tool's session; re-renders as answers come in. */
export function useToolSession(session: ToolSession): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState);
}
