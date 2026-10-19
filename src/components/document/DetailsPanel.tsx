"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Info, Lock, RotateCcw, ScanText, Sparkles } from "lucide-react";
import type { DocumentRecord, ImportantDate } from "@/lib/types";
import { useApp } from "@/lib/store/store";
import { confirmCategory, reprocess, setCategory, updateDocument } from "@/lib/store/app";
import { allCategories, categoryName } from "@/lib/organize/categories";
import { HINT_TO_KIND, primaryAmount } from "@/lib/organize/findings";
import { DATE_KINDS } from "@/lib/dates/kinds";
import { OCR_DOWNLOAD_MB, ocrEngineLoaded } from "@/lib/ingest/ocr";
import { cn, formatBytes, formatISODate, formatTimestamp, isValidISODate } from "@/lib/util";
import { ProgressBar, StatusPill } from "@/components/ui/Status";
import { TagEditor } from "./TagEditor";
import { DatesEditor, type DateDraft } from "./DatesEditor";
import { KIND_LABEL } from "@/components/library/DocBits";

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function Section({ title, children, aside, id }: { title: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="border-t border-line px-5 py-4 first:border-t-0" aria-labelledby={id}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 id={id} className="eyebrow">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return [
    saved,
    () => {
      setSaved(true);
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => setSaved(false), 1600);
    },
  ];
}

function NotesField({ doc }: { doc: DocumentRecord }) {
  const [v, setV] = useState(doc.notes);
  const [saved, flash] = useSavedFlash();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(v);
  latest.current = v;
  // Reset only when switching documents, never while the user is typing.
  useEffect(() => setV(doc.notes), [doc.id]);
  const save = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (latest.current !== doc.notes && (await updateDocument(doc.id, { notes: latest.current }))) flash();
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <div>
      <textarea
        aria-label="Notes"
        className="field min-h-[84px] resize-y text-[14px] leading-relaxed"
        placeholder="Anything worth remembering — where the paper copy is, who to call, what was agreed…"
        value={v}
        maxLength={10000}
        onChange={(e) => {
          setV(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(), 800);
        }}
        onBlur={() => void save()}
        data-testid="notes-input"
      />
      <p className={cn("mt-1 h-4 text-[12px] text-ok transition-opacity", saved ? "opacity-100" : "opacity-0")} aria-live="polite">
        {saved ? "Saved" : ""}
      </p>
    </div>
  );
}

function ProcessingSection({ doc }: { doc: DocumentRecord }) {
  const item = useApp((s) => s.queue.find((q) => q.docId === doc.id && (q.phase === "queued" || q.phase === "processing")));
  const ocrOn = useApp((s) => s.settings.ocrEnabled);
  const ex = doc.extraction;
  const canOcr = doc.kind === "image" || (doc.kind === "pdf" && ex.needsOcr);
  const methodLabel = { "pdf-text": "Text layer of the PDF", "pdf-ocr": "PDF text layer + on-device text recognition", ocr: "On-device text recognition (OCR)", plain: "Plain text file", none: "—" }[ex.method];
  return (
    <Section title="Text extraction" aside={<StatusPill status={item?.phase === "processing" ? "processing" : item ? "queued" : ex.status} />}>
      {item ? (
        <div className="space-y-2">
          <p className="text-[13.5px] text-ink-2">{item.progress?.label ?? "Waiting for other files to finish…"}</p>
          {item.phase === "processing" && <ProgressBar ratio={item.progress?.ratio ?? null} />}
        </div>
      ) : (
        <div className="space-y-2.5 text-[13.5px] text-ink-2">
          {ex.needsPassword && <PasswordForm docId={doc.id} />}
          {ex.message && !ex.needsPassword && (
            <p className={cn("flex gap-2 rounded-md px-2.5 py-2", ex.status === "failed" ? "bg-danger-soft text-danger" : ex.status === "partial" ? "bg-warn-soft text-warn" : "bg-paper-2")}>
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>{ex.message}</span>
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-ink-3">Source</dt>
            <dd>{methodLabel}</dd>
            {ex.pageCount !== undefined && (
              <>
                <dt className="text-ink-3">Pages</dt>
                <dd className="tnum">
                  {ex.pagesWithText ?? ex.pageCount} of {ex.pageCount} with text
                </dd>
              </>
            )}
            {ex.ocrConfidence !== undefined && (
              <>
                <dt className="text-ink-3">Recognition</dt>
                <dd className="tnum">{ex.ocrConfidence}% confidence</dd>
              </>
            )}
            <dt className="text-ink-3">Characters</dt>
            <dd className="tnum">{doc.textLength.toLocaleString()}</dd>
          </dl>
          <div className="flex flex-wrap gap-2 pt-1">
            {canOcr && (ex.status !== "completed" || ex.method !== "ocr") && (
              <button type="button" className="btn btn-sm" onClick={() => reprocess(doc.id, { forceOcr: true })}>
                <ScanText size={14} /> {ocrOn ? "Run text recognition" : "Run text recognition once"}
              </button>
            )}
            {(ex.status === "failed" || ex.status === "partial") && !canOcr && !ex.needsPassword && (
              <button type="button" className="btn btn-sm" onClick={() => reprocess(doc.id)}>
                <RotateCcw size={14} /> Try again
              </button>
            )}
            {ex.status === "completed" && (
              <button type="button" className="btn btn-ghost btn-sm text-ink-3" onClick={() => reprocess(doc.id, { forceOcr: doc.kind === "image" })}>
                <RotateCcw size={13} /> Read again
              </button>
            )}
          </div>
          {canOcr && !ocrEngineLoaded() && <p className="text-[12px] text-ink-3">The first run loads the text-recognition engine (~{OCR_DOWNLOAD_MB} MB) from this site. Your file isn’t sent anywhere.</p>}
        </div>
      )}
    </Section>
  );
}

/** Reads an encrypted PDF's text with a password that is used once and never stored. */
function PasswordForm({ docId }: { docId: string }) {
  const [pw, setPw] = useState("");
  const ex = useApp((s) => s.docMap.get(docId)?.extraction);
  return (
    <form
      className="space-y-2 rounded-md bg-warn-soft p-3 text-warn"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pw) return;
        reprocess(docId, { password: pw });
        setPw("");
      }}
    >
      <p className="flex gap-2">
        <Lock size={14} className="mt-0.5 shrink-0" />
        <span>{ex?.message ?? "This PDF is password-protected."}</span>
      </p>
      <div className="flex gap-2">
        <label htmlFor={`pw-${docId}`} className="sr-only">
          PDF password
        </label>
        <input id={`pw-${docId}`} type="password" autoComplete="off" className="field h-8 min-h-0 bg-card text-[13.5px] text-ink" placeholder="PDF password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="pdf-password" />
        <button type="submit" className="btn btn-sm btn-primary h-8" disabled={!pw}>
          Read text
        </button>
      </div>
      <p className="text-[12px] text-ink-3">The password is used once on this device and never saved. The extracted text is stored like any other document’s text, so search can find it.</p>
    </form>
  );
}

export function DetailsPanel({ doc, dates }: { doc: DocumentRecord; dates: ImportantDate[] }) {
  const custom = useApp((s) => s.categories);
  const [prefill, setPrefill] = useState<DateDraft | null>(null);
  const cats = allCategories(custom);
  const f = doc.findings;
  const total = primaryAmount(f);
  const usedDates = new Set(dates.map((d) => d.date));

  return (
    <div className="divide-y-0" data-testid="details-panel">
      <Section title="Category" id="cat-h">
        <select
          aria-labelledby="cat-h"
          className="field h-9 py-0"
          value={doc.categoryId ?? ""}
          onChange={(e) => void setCategory([doc.id], e.target.value || null)}
          data-testid="category-select"
        >
          <option value="">No category</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {doc.categoryId && (doc.categorySource === "suggested" || doc.categorySource === "rule") && (
          <div className="mt-2 flex items-start gap-2 text-[12.5px] text-ink-3">
            <Sparkles size={13} className="mt-0.5 shrink-0" />
            <span className="flex-1">
              {doc.categorySource === "suggested" ? (
                <>Suggested because the document mentions {joinWords(doc.categoryReasons) || "related words"}.</>
              ) : (
                <>Set by your rule: {doc.categoryReasons[0] ?? "a matching rule"}.</>
              )}
            </span>
            <button type="button" className="btn btn-ghost btn-sm h-6 px-2 text-[12px]" onClick={() => void confirmCategory(doc.id)}>
              <Check size={12} /> Confirm
            </button>
          </div>
        )}
      </Section>

      <Section title="Tags">
        <TagEditor doc={doc} />
      </Section>

      <Section title="Important dates">
        <DatesEditor doc={doc} dates={dates} prefill={prefill} onPrefillUsed={() => setPrefill(null)} />
      </Section>

      <Section title="Document date">
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Document date"
            className="field h-9 max-w-[12rem] px-2"
            value={doc.documentDate?.value ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              void updateDocument(doc.id, { documentDate: v && isValidISODate(v) ? { value: v, source: "user" } : null });
            }}
          />
          {doc.documentDate?.source === "suggested" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void updateDocument(doc.id, { documentDate: { value: doc.documentDate!.value, source: "user" } })}>
              <Check size={13} /> Confirm
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          {doc.documentDate?.source === "suggested" ? "Suggested from a date printed in the document — check it, then confirm." : "When the document was issued, e.g. the purchase or bill date."}
        </p>
      </Section>

      <Section title="Notes">
        <NotesField doc={doc} />
      </Section>

      {f && (f.amounts.length > 0 || f.dates.length > 0) && (
        <Section title="Found in the text" aside={<span className="text-[11.5px] text-ink-3">Not verified</span>}>
          <p className="mb-2.5 text-[12.5px] leading-snug text-ink-3">Amounts and dates printed in this document, found by pattern matching. They may be wrong — nothing is used until you confirm it.</p>
          {total && (
            <div className="mb-2 flex items-baseline justify-between rounded-md bg-paper-2 px-3 py-2">
              <span className="text-[13px] text-ink-2">{total.label}</span>
              <span className="serif text-[18px] font-medium tnum">{total.display}</span>
            </div>
          )}
          {f.amounts.filter((a) => a !== total).length > 0 && (
            <ul className="mb-3 space-y-1 text-[13px]">
              {f.amounts
                .filter((a) => a.display !== total?.display || a.label !== total?.label)
                .slice(0, 6)
                .map((a, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-ink-3">{a.label ?? "Amount"}</span>
                    <span className="tnum text-ink-2">{a.display}</span>
                  </li>
                ))}
            </ul>
          )}
          {f.dates.length > 0 && (
            <ul className="space-y-1.5">
              {f.dates.slice(0, 8).map((d, i) => {
                const kind = d.hint ? HINT_TO_KIND[d.hint] : null;
                return (
                  <li key={i} className="rounded-md border border-line px-2.5 py-2 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium tnum">
                        {formatISODate(d.date)}
                        {d.ambiguous && <span className="ml-1 font-normal text-warn" title="Written as numbers only — the day and month could be swapped. Check before using.">(check day/month)</span>}
                      </span>
                      {usedDates.has(d.date) ? (
                        <span className="text-[12px] text-ok">Added</span>
                      ) : kind ? (
                        <button type="button" className="btn btn-ghost btn-sm h-6 px-2 text-[12px] text-accent" onClick={() => setPrefill({ kind, date: d.date, note: "", remindDays: DATE_KINDS[kind].remindDays })}>
                          Add as {DATE_KINDS[kind].label.toLowerCase()}
                        </button>
                      ) : d.hint === "issued" && doc.documentDate?.value !== d.date ? (
                        <button type="button" className="btn btn-ghost btn-sm h-6 px-2 text-[12px] text-accent" onClick={() => void updateDocument(doc.id, { documentDate: { value: d.date, source: "user" } })}>
                          Use as document date
                        </button>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm h-6 px-2 text-[12px] text-ink-3" onClick={() => setPrefill({ kind: "other", date: d.date, note: "", remindDays: 7 })}>
                          Add as date…
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{d.context}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      <ProcessingSection doc={doc} />

      <Section title="File">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-ink-3">Name</dt>
          <dd className="break-all">{doc.fileName}</dd>
          <dt className="text-ink-3">Type</dt>
          <dd>
            {KIND_LABEL[doc.kind]} · {doc.mimeType}
          </dd>
          <dt className="text-ink-3">Size</dt>
          <dd className="tnum">{formatBytes(doc.size)}</dd>
          <dt className="text-ink-3">Added</dt>
          <dd className="tnum">{formatTimestamp(doc.importedAt)}</dd>
          {doc.fileModifiedAt && (
            <>
              <dt className="text-ink-3">File modified</dt>
              <dd className="tnum">{formatTimestamp(doc.fileModifiedAt)}</dd>
            </>
          )}
          <dt className="text-ink-3">Category</dt>
          <dd>{categoryName(doc.categoryId, custom) ?? "—"}</dd>
          <dt className="text-ink-3">SHA-256</dt>
          <dd className="truncate font-mono text-[11.5px] text-ink-3" title={doc.sha256}>
            {doc.sha256.slice(0, 16)}…
          </dd>
        </dl>
      </Section>
    </div>
  );
}
