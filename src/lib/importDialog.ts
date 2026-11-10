import { useSyncExternalStore } from "react";

/** Whether the Import dialog is open. Shared by the collections sidebar, the environment manager and Quick open. */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  open = next;
  listeners.forEach((l) => l());
}

export const openImportDialog = (): void => set(true);
export const closeImportDialog = (): void => set(false);

export function useImportDialog(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}
