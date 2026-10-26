/** Small stroke icons used across the shell. All are decorative (aria-hidden). */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "aria-hidden": true as const });

export function PlayIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinejoin="round" className={className}>
      <path d="M5 4l14 8-14 8z" />
    </svg>
  );
}

export function PlayFilledIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

export function SearchIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronIcon({ open, size = 12 }: IconProps & { open: boolean }) {
  return (
    <svg {...base(size)} strokeWidth={2.4} className={`section-chevron ${open ? "open" : ""}`}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function PencilIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </svg>
  );
}

export function SlidersIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinecap="round">
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

export function CopyIcon({ size = 13 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function CrossIcon({ size = 12 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={3} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function AlertIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18h0" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  );
}

export function LockIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

export function EyeIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" />
    </svg>
  );
}

export function TrashIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

export function MoreIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export function RequestsIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 7h11" />
      <path d="M12 4l3 3-3 3" />
      <path d="M20 17H9" />
      <path d="M12 14l-3 3 3 3" />
    </svg>
  );
}

export function TestingIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
      <path d="M7.5 14h9" />
    </svg>
  );
}

export function FlowsIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.5 6h7" />
      <path d="M7.2 8.2l3.6 7.4" />
      <path d="M16.8 8.2l-3.6 7.4" />
    </svg>
  );
}
