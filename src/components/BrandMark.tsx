/**
 * The REST Runner mark: a runner between JSON braces (4:3, viewBox 0 0 64 48).
 * Braces use --brand, the runner uses --text. Use it at least 20px tall; smaller, use the app icon.
 */
export function BrandMark({ height = 22, title }: { height?: number; title?: string }) {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 64 48"
      height={height}
      width={(height * 4) / 3}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.4}>
        <g stroke="var(--brand)">
          <path d="M10 6C5 6 6 10 6 16C6 21 4 24 2 24C4 24 6 27 6 32C6 38 5 42 10 42" />
          <path d="M54 6C59 6 58 10 58 16C58 21 60 24 62 24C60 24 58 27 58 32C58 38 59 42 54 42" />
        </g>
        <g stroke="var(--text)">
          <path d="M36 15L30 27" />
          <path d="M35.5 17L41 21L46 17" />
          <path d="M35 16.5L28 18.5L24 23" />
          <path d="M30 27L38 31L36.5 40" />
          <path d="M30 27L24.5 34L17 34.5" />
        </g>
      </g>
      <circle cx="39" cy="9" r="4.2" fill="var(--text)" />
    </svg>
  );
}

/** Mark plus the name "rest-runner" in monospace, with the hyphen in --brand. Used in the top bar. */
export function BrandLockup() {
  return (
    <div className="brand-lockup" role="img" aria-label="REST Runner">
      <BrandMark height={22} />
      <span className="brand-name" aria-hidden>
        rest<span className="brand-hyphen">-</span>runner
      </span>
    </div>
  );
}
