import { createContext, useContext } from "react";

/**
 * The element beside the sections, above the status bar, where the Variables and Certificates panels both sit,
 * so they open the same way: beside the content, full window height, never over it. Root provides it.
 */
export const SidePanelSlotContext = createContext<HTMLElement | null>(null);

export function useSidePanelSlot(): HTMLElement | null {
  return useContext(SidePanelSlotContext);
}
