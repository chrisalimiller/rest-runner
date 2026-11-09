import type { ReactNode } from "react";

/**
 * Animated show/hide for small, always-rendered content. Height animates with the grid-rows trick;
 * closed content is inert and visibility:hidden, so focus and screen readers skip it.
 * Do not use for long lists: the children stay mounted while closed.
 */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`collapse ${open ? "open" : ""} ${className ?? ""}`}>
      <div className="collapse-inner" inert={!open}>
        {children}
      </div>
    </div>
  );
}
