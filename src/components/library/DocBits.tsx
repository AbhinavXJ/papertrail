"use client";

import { useEffect, useState } from "react";
import { CalendarClock, FileImage, FileText, FileType2 } from "lucide-react";
import type { DocumentRecord, ImportantDate } from "@/lib/types";
import { usePreviewUrl } from "@/lib/hooks";
import { getDocumentText } from "@/lib/store/app";
import { DATE_KINDS } from "@/lib/dates/kinds";
import { reminderState } from "@/lib/dates/reminders";
import { cn, daysBetween, formatISODate, relativeDays, todayISO } from "@/lib/util";
import { highlightSegments, type HighlightSpec } from "@/lib/search/tokenize";

export function docHref(id: string, q?: string, page?: number | null): string {
  const p = new URLSearchParams({ id });
  if (q?.trim()) p.set("q", q.trim());
  if (page) p.set("page", String(page));
  return `/document/?${p.toString()}`;
}

export const KIND_LABEL: Record<DocumentRecord["kind"], string> = { pdf: "PDF", image: "Image", text: "Text" };

export function KindIcon({ kind, size = 18, className }: { kind: DocumentRecord["kind"]; size?: number; className?: string }) {
  const Icon = kind === "pdf" ? FileType2 : kind === "image" ? FileImage : FileText;
  return <Icon size={size} className={className} aria-hidden />;
}

/** Small paper tile: the stored thumbnail when there is one, otherwise a type icon. */
export function DocThumb({ doc, className }: { doc: DocumentRecord; className?: string }) {
  const url = usePreviewUrl(doc.id, doc.extraction.updatedAt, doc.hasPreview);
  return (
    <span className={cn("relative grid h-11 w-9 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line bg-card text-ink-3 shadow-[var(--shadow-soft)]", className)} aria-hidden>
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover object-top" draggable={false} />
      ) : (
        <KindIcon kind={doc.kind} size={16} />
      )}
    </span>
  );
}

const textPreviewCache = new Map<string, string>();

function useTextPreview(doc: DocumentRecord, enabled: boolean): string | null {
  const key = `${doc.id}:${doc.extraction.updatedAt}`;
  const [text, setText] = useState<string | null>(() => textPreviewCache.get(key) ?? null);
  useEffect(() => {
    if (!enabled || textPreviewCache.has(key)) return;
    let alive = true;
    getDocumentText(doc.id)
      .then((t) => {
        let s = (t?.text ?? "").slice(0, 700);
        if (doc.mimeType === "text/markdown")
          s = s
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/\*\*|__|`/g, "")
            .replace(/^\s*[-*+]\s+/gm, "• ");
        if (textPreviewCache.size > 300) textPreviewCache.delete(textPreviewCache.keys().next().value!);
        textPreviewCache.set(key, s);
        if (alive) setText(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, doc.id, enabled]);
  return text;
}

/** Large preview for grid cards. Text documents show their opening lines. */
export function DocPreview({ doc }: { doc: DocumentRecord }) {
  const url = usePreviewUrl(doc.id, doc.extraction.updatedAt, doc.hasPreview);
  const text = useTextPreview(doc, !doc.hasPreview && doc.kind === "text");
  return (
    <div className="relative h-full w-full overflow-hidden bg-card">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover object-top" draggable={false} />
      ) : text ? (
        <div className="h-full overflow-hidden whitespace-pre-line px-4 py-3.5 font-serif text-[10.5px] leading-[1.5] text-ink-2 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">{text}</div>
      ) : (
        <div className="grid h-full place-items-center text-ink-4">
          <KindIcon kind={doc.kind} size={34} />
        </div>
      )}
    </div>
  );
}

export function Highlighted({ text, spec }: { text: string; spec: HighlightSpec | null }) {
  if (!spec) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, spec).map(([t, hit], i) => (hit ? <mark key={i}>{t}</mark> : <span key={i}>{t}</span>))}
    </>
  );
}

/** The next active important date for a document, with urgency. */
export function nextDate(dates: readonly ImportantDate[] | undefined, today = todayISO()): ImportantDate | null {
  if (!dates?.length) return null;
  const active = dates.filter((d) => d.status === "active").sort((a, b) => a.date.localeCompare(b.date));
  return active.find((d) => d.date >= today) ?? active[active.length - 1] ?? null;
}

export function DateIndicator({ dates, compact }: { dates: readonly ImportantDate[] | undefined; compact?: boolean }) {
  const d = nextDate(dates);
  if (!d) return null;
  const today = todayISO();
  const state = reminderState(d, today);
  const days = daysBetween(today, d.date);
  const label = `${state === "passed" ? DATE_KINDS[d.kind].past : DATE_KINDS[d.kind].label} ${formatISODate(d.date)} (${relativeDays(days)})`;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[12px] font-medium", state === "due" ? "text-warn" : state === "passed" ? "text-danger" : "text-ink-3")}
      title={label}
    >
      <CalendarClock size={13} aria-hidden />
      {compact ? <span className="sr-only">{label}</span> : <span className="tnum">{relativeDays(days)}</span>}
    </span>
  );
}
