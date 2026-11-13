import { useSyncExternalStore } from "react";
import { getRainbowBrackets, subscribeRainbowBrackets } from "../lib/rainbowBrackets";

/** Whether rainbow brackets are on (Settings > General). Code views re-render the moment it changes. */
export function useRainbowBrackets(): boolean {
  return useSyncExternalStore(subscribeRainbowBrackets, getRainbowBrackets, () => true);
}
