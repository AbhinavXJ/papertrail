"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Maximize2, Minimize2 } from "lucide-react";
import type { DocumentRecord, TextRecord } from "@/lib/types";
import { decodeText } from "@/lib/ingest/sniff";
import { highlightDom } from "@/lib/search/highlight-dom";
import { highlightSegments, type HighlightSpec } from "@/lib/search/tokenize";
import { useObjectUrl } from "@/lib/hooks";
import { toast } from "@/lib/store/store";
import { cn, plural } from "@/lib/util";
import { Spinner } from "@/components/ui/Status";

export function ImageViewer({ blob, alt }: { blob: Blob; alt: string }) {
  const url = useObjectUrl(blob);
  const [actual, setActual] = useState(false);
  const [broken, setBroken] = useState(false);
  if (broken) return <p className="py-16 text-center text-[14px] text-ink-3">This image can’t be displayed by your browser. You can still download the original.</p>;
  return (
    <div className="relative">
      <button type="button" className="btn btn-sm absolute right-2 top-2 z-[1] bg-card/90 backdrop-blur" onClick={() => setActual((a) => !a)} aria-pressed={actual}>
        {actual ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {actual ? "Fit" : "Actual size"}
      </button>
      <div className={cn("overflow-auto rounded-[8px] border border-line bg-paper-2", actual ? "max-h-[80vh]" : "")}>
        {url && (
          <img src={url} alt={alt} onError={() => setBroken(true)} className={cn("mx-auto block", actual ? "max-w-none" : "max-h-[78vh] w-auto max-w-full object-contain")} />
        )}
      </div>
    </div>
  );
}

/** Renders a stored text or Markdown file. Markdown is sanitized and may not load remote images. */
export function TextFileViewer({ blob, doc, spec }: { blob: Blob; doc: DocumentRecord; spec: HighlightSpec | null }) {
  const [text, setText] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isMd = doc.mimeType === "text/markdown";
  useEffect(() => {
    let alive = true;
    blob.arrayBuffer().then(async (buf) => {
      const t = decodeText(new Uint8Array(buf));
      if (!alive) return;
      setText(t);
      if (isMd) {
        const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
        const raw = await marked.parse(t, { gfm: true, breaks: false });
        const clean = DOMPurify.sanitize(raw, { FORBID_TAGS: ["img", "picture", "source", "video", "audio", "iframe", "style", "form", "input"], FORBID_ATTR: ["style", "srcset"] });
        if (alive) setHtml(clean);
      }
    });
    return () => {
      alive = false;
    };
  }, [blob, isMd]);
  useEffect(() => {
    if (!ref.current || html === null) return;
    ref.current.querySelectorAll("a").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
    highlightDom(ref.current, spec);
  }, [html, spec]);

  if (text === null || (isMd && html === null))
    return (
      <div className="flex items-center gap-2 py-16 text-[14px] text-ink-3">
        <Spinner /> Loading…
      </div>
    );
  if (isMd) return <div ref={ref} className="prose-doc mx-auto max-w-[680px] rounded-[10px] border border-line bg-card px-6 py-8 sm:px-10" dangerouslySetInnerHTML={{ __html: html! }} />;
  return (
    <div className={cn("mx-auto max-w-[720px] whitespace-pre-wrap break-words rounded-[10px] border border-line bg-card px-6 py-8 sm:px-10", doc.mimeType === "text/csv" ? "font-mono text-[13px] leading-6" : "prose-doc")}>
      {highlightSegments(text, spec ?? { terms: [], prefixes: [] }).map(([t, hit], i) => (hit ? <mark key={i}>{t}</mark> : <span key={i}>{t}</span>))}
    </div>
  );
}

/** The extracted text with page markers, highlighted matches and match navigation. */
export function ExtractedText({ text, spec, kind }: { text: TextRecord | null; spec: HighlightSpec | null; kind: DocumentRecord["kind"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const pages = useMemo(() => {
    if (!text) return [];
    const offs = text.pageOffsets?.length ? text.pageOffsets : [0];
    return offs.map((start, i) => text.text.slice(start, offs[i + 1] ?? text.text.length).replace(/^\n+|\n+$/g, ""));
  }, [text]);
  const matchCount = useMemo(() => (spec && text ? highlightSegments(text.text, spec).filter(([, h]) => h).length : 0), [text, spec]);
  useEffect(() => setCur(0), [spec, text]);
  const go = (i: number) => {
    const marks = ref.current?.querySelectorAll("mark");
    if (!marks?.length) return;
    const k = (i + marks.length) % marks.length;
    marks.forEach((m, j) => m.classList.toggle("ring-2", j === k));
    marks[k].scrollIntoView({ block: "center", behavior: "smooth" });
    setCur(k);
  };
  if (!text?.text)
    return (
      <p className="rounded-[10px] border border-dashed border-line-2 px-6 py-12 text-center text-[14px] text-ink-3">
        No text was extracted from this {kind === "image" ? "image" : "document"}. It can still be found by its title, file name, tags and notes.
      </p>
    );
  return (
    <div>
      <div className="sticky top-14 z-10 mb-3 flex flex-wrap items-center gap-2 lg:top-0">
        <span className="rounded-md bg-card/90 px-2.5 py-1 text-[12.5px] text-ink-3 shadow-[var(--shadow-soft)] backdrop-blur">
          {plural(text.text.length, "character")}
          {pages.length > 1 && ` · ${plural(pages.length, "page")}`}
        </span>
        {spec && matchCount > 0 && (
          <span className="flex items-center gap-1 rounded-md bg-card/90 px-1 py-0.5 text-[12.5px] text-ink-2 shadow-[var(--shadow-soft)] backdrop-blur">
            <span className="px-1.5 tnum">
              {cur + 1} / {matchCount}
            </span>
            <button type="button" className="btn btn-ghost btn-sm btn-icon h-6 w-6" onClick={() => go(cur - 1)} aria-label="Previous match">
              <ChevronUp size={14} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon h-6 w-6" onClick={() => go(cur + 1)} aria-label="Next match">
              <ChevronDown size={14} />
            </button>
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm ml-auto"
          onClick={() =>
            navigator.clipboard.writeText(text.text).then(
              () => toast("Text copied.", "success"),
              () => toast("Couldn't copy to the clipboard.", "error"),
            )
          }
        >
          <Copy size={13} /> Copy text
        </button>
      </div>
      <div ref={ref} className="rounded-[10px] border border-line bg-card px-5 py-6 sm:px-8" data-testid="extracted-text">
        {pages.map((p, i) => (
          <section key={i} aria-label={pages.length > 1 ? `Page ${i + 1}` : undefined}>
            {pages.length > 1 && <div className="eyebrow mb-3 mt-6 flex items-center gap-3 first:mt-0">Page {i + 1}<span className="h-px flex-1 bg-line" /></div>}
            <div className="whitespace-pre-wrap break-words font-serif text-[15.5px] leading-[1.7] text-ink">
              {highlightSegments(p, spec ?? { terms: [], prefixes: [] }).map(([t, hit], k) => (hit ? <mark key={k}>{t}</mark> : <span key={k}>{t}</span>))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
