import { createContext, useContext } from "react";

/**
 * The element between the sections and the side rail where the Variables and Certificates panels both sit,
 * so they open the same way: beside the content, full window height, never over it. Root provides it.
 */
export const SidePanelSlotContext = createContext<HTMLElement | null>(null);

export function useSidePanelSlot(): HTMLElement | null {
  return useContext(SidePanelSlotContext);
}
