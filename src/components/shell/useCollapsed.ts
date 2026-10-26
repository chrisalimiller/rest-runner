import { useCallback, useState } from "react";
import { load, save } from "../../lib/storage";

/** A true/false choice remembered in local storage, for example whether a list is folded away. */
export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => load<boolean>(key, false) === true);
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      save(key, !c);
      return !c;
    });
  }, [key]);
  return [collapsed, toggle];
}
