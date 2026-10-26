import { useSyncExternalStore } from "react";

/** Whether the Certificates dialog is open, and which entry it shows. Shared by the top bar, the URL chip and Root. */
interface State {
  open: boolean;
  entryId: string | null;
}

let state: State = { open: false, entryId: null };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function openCertificates(entryId: string | null = null): void {
  set({ open: true, entryId });
}

export function closeCertificates(): void {
  set({ open: false, entryId: null });
}

export function useCertificatesDialog(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
