import { ChevronIcon } from "../shell/Icons";

interface Props {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Shown next to the label while collapsed. */
  summary?: React.ReactNode;
  /** Shown at the right of the header, open or closed. */
  meta?: React.ReactNode;
  /** Controls in the header that are not part of the toggle (for example the body mode). Shown only while open, in place of meta. */
  controls?: React.ReactNode;
  children: React.ReactNode;
  grow?: boolean;
}

/** A collapsible part of the request (Params, Auth, Headers, Body) with a one-line summary when closed. */
export function Section({ id, label, open, onToggle, summary, meta, controls, children, grow }: Props) {
  const bodyId = `section-${id}`;
  const showControls = open && !!controls;
  return (
    <div className={`req-section ${open ? "open" : ""} ${grow && open ? "grow" : ""}`} data-section={id}>
      <div className="req-section-head">
        <button className={`req-section-toggle ${showControls ? "" : "fill"}`} onClick={onToggle} aria-expanded={open} aria-controls={bodyId}>
          <ChevronIcon open={open} />
          <span className="req-section-label">{label}</span>
          {!open && summary !== undefined && <span className="req-section-summary">{summary}</span>}
          {!showControls && meta && <span className="req-section-meta">{meta}</span>}
        </button>
        {showControls && <div className="req-section-controls">{controls}</div>}
      </div>
      {open && (
        <div className="req-section-body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  );
}
