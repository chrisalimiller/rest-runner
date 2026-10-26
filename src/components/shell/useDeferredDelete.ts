import { useCallback, useState } from "react";
import { useToast } from "./Toast";

/**
 * Deleting a saved run (kept in IndexedDB) with Undo: the run is hidden at once and only
 * removed for good when the Undo toast goes away. `hidden` holds the ids to leave out of lists.
 */
export function useDeferredDelete(remove: (id: string) => Promise<void>, refresh: () => void) {
  const toast = useToast();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const request = useCallback(
    (id: string, message: string) => {
      setHidden((s) => new Set(s).add(id));
      const settle = () =>
        setHidden((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      toast.show({
        message,
        onUndo: settle,
        onExpire: () =>
          void remove(id).finally(() => {
            refresh();
            settle();
          }),
      });
    },
    [toast, remove, refresh],
  );

  return { hidden, request };
}
