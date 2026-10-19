import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { ExtractionStatus } from "@/lib/types";
import { cn } from "@/lib/util";

export const STATUS_LABEL: Record<ExtractionStatus, string> = {
  queued: "Queued",
  processing: "Reading text…",
  completed: "Text ready",
  partial: "Partly read",
  failed: "Couldn't read",
};

export function StatusPill({ status, className, compact }: { status: ExtractionStatus; className?: string; compact?: boolean }) {
  const tone = {
    queued: "bg-paper-2 text-ink-3",
    processing: "bg-accent-soft text-accent",
    completed: "bg-ok-soft text-ok",
    partial: "bg-warn-soft text-warn",
    failed: "bg-danger-soft text-danger",
  }[status];
  const Icon = { queued: Clock, processing: Loader2, completed: CheckCircle2, partial: AlertTriangle, failed: XCircle }[status];
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium", tone, className)} title={STATUS_LABEL[status]}>
      <Icon size={13} className={status === "processing" ? "animate-spin" : undefined} aria-hidden />
      {compact ? <span className="sr-only">{STATUS_LABEL[status]}</span> : STATUS_LABEL[status]}
    </span>
  );
}

export function ProgressBar({ ratio, className, label }: { ratio: number | null; className?: string; label?: string }) {
  return (
    <div
      className={cn("relative h-1 w-full overflow-hidden rounded-full bg-line", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
    >
      {ratio === null ? (
        <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
      )}
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn("animate-spin text-ink-3", className)} aria-hidden />;
}
