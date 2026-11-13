import { useSyncExternalStore } from "react";

/**
 * The Requests collections sidebar, as the status bar's toggle sees it. The sidebar's state lives in the Requests mode;
 * that mode publishes whether it is open and how to flip it, and the status bar reads this to draw the button.
 */
export interface RequestsSidebarControl {
  open: boolean;
  toggle: () => void;
}

let control: RequestsSidebarControl | null = null;
const listeners = new Set<() => void>();

/** Called by the Requests mode whenever the sidebar opens or closes. Pass null when it goes away. */
export function publishRequestsSidebar(next: RequestsSidebarControl | null): void {
  if (control === next || (control && next && control.open === next.open && control.toggle === next.toggle)) return;
  control = next;
  listeners.forEach((l) => l());
}

export function useRequestsSidebar(): RequestsSidebarControl | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => control,
  );
}
