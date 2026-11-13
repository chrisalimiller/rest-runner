import type { CSSProperties } from "react";

interface Props {
  /** Run the stride (two poses swapping, with a small bob). Off, the runner stands in its first pose. */
  live?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * The runner from the logo, without the braces, for anything that is in flight. It is drawn in the text color,
 * never purple (BRAND.md). Two poses swap in steps to read as a stride; the motion lives in motion.css.
 */
export function RunnerMark({ live = false, className = "", style }: Props) {
  return (
    <span className={`runner ${live ? "live" : ""} ${className}`.trim()} style={style} aria-hidden>
      <svg viewBox="14 3 36 41">
        <circle cx="39" cy="9" r="4.2" fill="currentColor" />
        <g fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M36 15L30 27" />
          <g className="pose-a">
            <path d="M35.5 17L41 21L46 17" />
            <path d="M35 16.5L28 18.5L24 23" />
            <path d="M30 27L38 31L36.5 40" />
            <path d="M30 27L24.5 34L17 34.5" />
          </g>
          <g className="pose-b">
            <path d="M35.5 17L39 23L44 24" />
            <path d="M35 16.5L31 22L26 20" />
            <path d="M30 27L31 34L29 41" />
            <path d="M30 27L22 31L15 28" />
          </g>
        </g>
      </svg>
    </span>
  );
}
