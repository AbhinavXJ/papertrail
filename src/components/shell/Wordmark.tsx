import { cn } from "@/lib/util";

export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="4.5" y="2.5" width="13" height="17" rx="1.6" fill="var(--card)" stroke="currentColor" strokeWidth="1.4" />
      <rect x="7" y="5" width="13" height="17" rx="1.6" fill="var(--card)" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 10h7M10 13h7M10 16h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <Mark />
      <span className="serif text-[21px] font-semibold tracking-[-0.02em]">Papertrail</span>
    </span>
  );
}
