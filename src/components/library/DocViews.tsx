"use client";

import Link from "next/link";
import { useRef } from "react";
import { Check } from "lucide-react";
import type { DocumentRecord, ImportantDate } from "@/lib/types";
import { useApp } from "@/lib/store/store";
import { setView, useLibraryView } from "@/lib/store/library-view";
import { categoryName } from "@/lib/organize/categories";
import { useElementWidth, useMediaQuery, useWindowVirtual } from "@/lib/hooks";
import { cn, formatISODate, formatTimestamp } from "@/lib/util";
import { StatusPill } from "@/components/ui/Status";
import { DateIndicator, DocPreview, DocThumb, docHref } from "./DocBits";
import { RowMenu } from "./DocActions";

export function toggleSelected(id: string) {
  setView((v) => {
    const s = new Set(v.selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    return { selected: s };
  });
}

export function SelectBox({ checked, onChange, label, className }: { checked: boolean | "mixed"; onChange: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors",
        checked ? "border-accent bg-accent text-accent-ink" : "border-line-2 bg-card hover:border-ink-4",
        className,
      )}
    >
      {checked === "mixed" ? <span className="h-0.5 w-2 rounded bg-current" /> : checked && <Check size={12} strokeWidth={3} />}
    </button>
  );
}

function useMeta() {
  const custom = useApp((s) => s.categories);
  const tagMap = useApp((s) => s.tagMap);
  return { custom, tagMap };
}

const ROW_H = 64;

export function DocList({ docs, datesByDoc }: { docs: DocumentRecord[]; datesByDoc: Map<string, ImportantDate[]> }) {
  const ref = useRef<HTMLDivElement>(null);
  const { start, end, total } = useWindowVirtual(ref, docs.length, ROW_H);
  const { selected } = useLibraryView();
  const { custom, tagMap } = useMeta();
  const wide = useMediaQuery("(min-width: 900px)");
  const all = docs.length > 0 && docs.every((d) => selected.has(d.id));
  const some = !all && docs.some((d) => selected.has(d.id));
  const cols = wide ? "grid-cols-[22px_36px_minmax(0,1fr)_minmax(0,180px)_112px_100px_32px]" : "grid-cols-[22px_36px_minmax(0,1fr)_32px]";

  return (
    <div className="mt-3">
      <div className={cn("grid items-center gap-x-4 border-b border-line px-3 pb-2 text-[12px] font-medium text-ink-3", cols)}>
        <SelectBox checked={all ? true : some ? "mixed" : false} label={all ? "Deselect all" : "Select all"} onChange={() => setView({ selected: all ? new Set() : new Set(docs.map((d) => d.id)) })} />
        <span />
        <span>Document</span>
        {wide && (
          <>
            <span>Category</span>
            <span>Document date</span>
            <span>Added</span>
          </>
        )}
        <span />
      </div>
      <div ref={ref} role="list" aria-label="Documents" style={{ height: total, position: "relative" }}>
        {docs.slice(start, end).map((d, i) => {
          const cat = categoryName(d.categoryId, custom);
          const isSel = selected.has(d.id);
          const tags = d.tagIds.map((t) => tagMap.get(t)?.name).filter(Boolean) as string[];
          return (
            <div
              key={d.id}
              role="listitem"
              aria-posinset={start + i + 1}
              aria-setsize={docs.length}
              data-testid="doc-row"
              className={cn("group absolute inset-x-0 grid items-center gap-x-4 border-b border-line px-3 transition-colors hover:bg-hover", cols, isSel && "bg-accent-soft/60 hover:bg-accent-soft")}
              style={{ top: (start + i) * ROW_H, height: ROW_H }}
            >
              <SelectBox checked={isSel} onChange={() => toggleSelected(d.id)} label={`Select ${d.title}`} className="relative z-[1]" />
              <DocThumb doc={d} />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Link href={docHref(d.id)} className="truncate text-[15px] font-medium text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-accent">
                    {d.title}
                  </Link>
                  {d.extraction.status !== "completed" && <StatusPill status={d.extraction.status} compact={!wide} className="relative" />}
                  <DateIndicator dates={datesByDoc.get(d.id)} compact={!wide} />
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12.5px] text-ink-3">
                  {!wide && cat && <span className="shrink-0">{cat}</span>}
                  {!wide && cat && <span aria-hidden>·</span>}
                  <span className="truncate">{d.fileName}</span>
                  {wide && tags.slice(0, 3).map((t) => <span key={t} className="tag h-[18px] text-[11px]">{t}</span>)}
                </div>
              </div>
              {wide && (
                <>
                  <span className="truncate text-[13.5px] text-ink-2">
                    {cat ? (
                      <span className={cn(d.categorySource === "suggested" && "border-b border-dotted border-ink-4")} title={d.categorySource === "suggested" ? "Suggested from the document's words — open it to keep or change" : undefined}>
                        {cat}
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </span>
                  <span className="text-[13.5px] tnum text-ink-2">
                    {d.documentDate ? (
                      <span className={cn(d.documentDate.source === "suggested" && "border-b border-dotted border-ink-4 text-ink-3")} title={d.documentDate.source === "suggested" ? "Suggested from a date printed in the document — not confirmed" : undefined}>
                        {formatISODate(d.documentDate.value)}
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </span>
                  <span className="text-[13.5px] text-ink-3 tnum">{formatTimestamp(d.importedAt)}</span>
                </>
              )}
              <div className="relative z-[1] opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <RowMenu doc={d} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CARD_MIN = 176;
const CARD_GAP = 18;

export function DocGrid({ docs, datesByDoc }: { docs: DocumentRecord[]; datesByDoc: Map<string, ImportantDate[]> }) {
  const outer = useRef<HTMLDivElement>(null);
  const width = useElementWidth(outer);
  const cols = Math.max(2, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP)));
  const cardW = width ? (width - CARD_GAP * (cols - 1)) / cols : CARD_MIN;
  const rowH = Math.round(cardW * 1.3) + 74 + CARD_GAP;
  const rows = Math.ceil(docs.length / cols);
  const { start, end, total } = useWindowVirtual(outer, rows, rowH, 2);
  const { selected } = useLibraryView();
  const { custom } = useMeta();
  return (
    <div ref={outer} className="relative mt-5" style={{ height: total }} role="list" aria-label="Documents">
      {width > 0 &&
        Array.from({ length: Math.max(0, end - start) }, (_, r) => {
          const row = start + r;
          return docs.slice(row * cols, row * cols + cols).map((d, c) => {
            const isSel = selected.has(d.id);
            const cat = categoryName(d.categoryId, custom);
            return (
              <div
                key={d.id}
                role="listitem"
                data-testid="doc-card"
                className="group absolute"
                style={{ top: row * rowH, left: c * (cardW + CARD_GAP), width: cardW, height: rowH - CARD_GAP }}
              >
                <div className={cn("relative overflow-hidden rounded-[8px] border bg-card shadow-[var(--shadow-soft)] transition-shadow group-hover:shadow-[var(--shadow-pop)]", isSel ? "border-accent ring-2 ring-accent/30" : "border-line")} style={{ height: Math.round(cardW * 1.3) }}>
                  <DocPreview doc={d} />
                  <div className={cn("absolute left-2 top-2 z-[2] transition-opacity", isSel ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}>
                    <SelectBox checked={isSel} onChange={() => toggleSelected(d.id)} label={`Select ${d.title}`} />
                  </div>
                  {d.extraction.status !== "completed" && <StatusPill status={d.extraction.status} compact className="absolute bottom-2 right-2 z-[2] shadow-[var(--shadow-soft)]" />}
                  <div className="absolute right-1.5 top-1.5 z-[2] rounded-md bg-card/90 opacity-100 shadow-[var(--shadow-soft)] backdrop-blur transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    <RowMenu doc={d} />
                  </div>
                </div>
                <div className="mt-2.5 px-0.5">
                  <Link href={docHref(d.id)} className="serif line-clamp-2 min-h-[2.75em] text-[15px] font-medium leading-snug text-ink after:absolute after:inset-0 after:content-['']">
                    {d.title}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                    <span className="truncate">{cat ?? "Uncategorized"}</span>
                    <DateIndicator dates={datesByDoc.get(d.id)} compact />
                    <span className="ml-auto shrink-0 tnum">{d.documentDate && d.documentDate.source === "user" ? formatISODate(d.documentDate.value) : formatTimestamp(d.importedAt)}</span>
                  </div>
                </div>
              </div>
            );
          });
        })}
    </div>
  );
}
