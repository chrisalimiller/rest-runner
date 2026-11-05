import { useSyncExternalStore } from "react";

/** Whether the About / Check for updates dialog is open. Shared by the top bar, Quick open and the macOS menu. */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  open = next;
  listeners.forEach((l) => l());
}

export const openUpdateDialog = (): void => set(true);
export const closeUpdateDialog = (): void => set(false);

export function useUpdateDialog(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}
