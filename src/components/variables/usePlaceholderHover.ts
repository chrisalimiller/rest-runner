import { useCallback, useRef, useState } from "react";
import { placeholderAt } from "../../lib/requestSummary";
import { useVariables } from "./VariablesContext";

/**
 * Hover and Ctrl/Cmd+I support for a text input that draws its placeholders in a mirror behind it.
 * The input takes every pointer event, so the pointer is checked against the rectangles of the mirror's placeholder spans.
 * Does nothing outside Requests mode, where there is no VariablesContext.
 */
export function usePlaceholderHover(spanSelector: string) {
  const api = useVariables();
  const root = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  const spans = () => [...(root.current?.querySelectorAll<HTMLElement>(spanSelector) ?? [])];

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      if (!api) return;
      const hit = spans().find((s) => {
        const r = s.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      setOver(!!hit);
      if (hit?.dataset.name) api.hoverShow(hit.dataset.name, hit.getBoundingClientRect(), e.currentTarget);
      else api.hoverLeave();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  const onMouseLeave = useCallback(() => {
    setOver(false);
    api?.hoverLeave();
  }, [api]);

  /** Returns true when it handled the key. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!api || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "i") return false;
      const input = e.currentTarget;
      const at = placeholderAt(input.value, input.selectionStart ?? 0);
      const span = at ? spans()[at.index] : undefined;
      if (!at || !span) return false;
      e.preventDefault();
      api.hoverOpen(at.name, span.getBoundingClientRect(), input);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  return { root, over: over && !!api, onMouseMove, onMouseLeave, onKeyDown };
}
