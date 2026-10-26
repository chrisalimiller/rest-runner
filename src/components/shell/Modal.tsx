import { useRef } from "react";
import { useEscape } from "../useEscape";
import { useFocusTrap } from "../useFocusTrap";

interface Props {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Class of the dialog box itself, after `modal` (or `sheet` with `sheet`). */
  className?: string;
  /** A side sheet instead of a centred modal. */
  sheet?: boolean;
}

/** A modal dialog: backdrop click and Escape close it, Tab stays inside, focus goes back to where it was. */
export function Modal({ label, onClose, children, className = "", sheet = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(box);
  return (
    <div className={sheet ? "sheet-backdrop" : "modal-backdrop"} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`${sheet ? "sheet" : "modal"} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
