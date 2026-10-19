"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Lock, Minus, Plus } from "lucide-react";
import { closePdf, loadPdfJs, openPdf, passwordProblem, pdfErrorMessage } from "@/lib/ingest/pdf";
import { highlightDom } from "@/lib/search/highlight-dom";
import type { HighlightSpec } from "@/lib/search/tokenize";
import { useElementWidth } from "@/lib/hooks";
import { Spinner } from "@/components/ui/Status";

interface PageSize {
  w: number;
  h: number;
}

/**
 * Renders a PDF with pdf.js: pages are drawn only when they scroll into view (and released when
 * far away), with pdf.js's selectable text layer on top so search matches can be highlighted.
 */
export function PdfViewer({ blob, spec, initialPage, onError }: { blob: Blob; spec: HighlightSpec | null; initialPage: number | null; onError: (message: string) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrap);
  const jumped = useRef(false);
  // Encrypted PDFs: the password lives only in this component's memory while it's open.
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [pwProblem, setPwProblem] = useState<"needed" | "wrong" | null>(null);
  const [pwDraft, setPwDraft] = useState("");

  useEffect(() => {
    let alive = true;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      try {
        doc = await openPdf(await blob.arrayBuffer(), { transfer: true, password });
        setPwProblem(null);
        const s: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const v = p.getViewport({ scale: 1 });
          s.push({ w: v.width, h: v.height });
        }
        if (!alive) return;
        setSizes(s);
        setPdf(doc);
      } catch (e) {
        if (!alive) return;
        const pw = passwordProblem(e);
        if (pw) setPwProblem(pw);
        else onError(pdfErrorMessage(e));
      }
    })();
    return () => {
      alive = false;
      if (doc) void closePdf(doc);
    };
  }, [blob, onError, password]);

  const base = Math.min(Math.max(width - 2, 200), 880);
  const pageWidth = Math.round(base * zoom);

  useEffect(() => {
    if (!pdf || jumped.current || !initialPage || initialPage < 2) return;
    jumped.current = true;
    requestAnimationFrame(() => document.getElementById(`pdf-page-${initialPage}`)?.scrollIntoView({ block: "start" }));
  }, [pdf, initialPage]);

  if (!pdf && pwProblem)
    return (
      <div ref={wrap} className="grid min-h-[40vh] place-items-center rounded-[10px] border border-dashed border-line-2 px-6 py-10">
        <form
          className="w-full max-w-sm text-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pwDraft) return;
            setPassword(pwDraft);
            setPwDraft("");
          }}
        >
          <Lock size={22} className="mx-auto text-ink-3" />
          <p className="mt-3 text-[15px] font-medium text-ink">{pwProblem === "wrong" ? "That password didn’t work" : "This PDF is password-protected"}</p>
          <p className="mt-1 text-[13px] text-ink-3">Enter its password to view it. The password stays in this tab and isn’t saved.</p>
          <div className="mt-4 flex gap-2">
            <label htmlFor="viewer-pw" className="sr-only">
              PDF password
            </label>
            <input id="viewer-pw" type="password" autoComplete="off" autoFocus className="field" value={pwDraft} onChange={(e) => setPwDraft(e.target.value)} data-testid="viewer-password" />
            <button type="submit" className="btn btn-primary" disabled={!pwDraft}>
              Open
            </button>
          </div>
        </form>
      </div>
    );

  if (!pdf)
    return (
      <div ref={wrap} className="grid min-h-[50vh] place-items-center">
        <span className="flex items-center gap-2 text-[14px] text-ink-3">
          <Spinner /> Opening PDF…
        </span>
      </div>
    );

  return (
    <div ref={wrap} className="relative">
      <div className="sticky top-14 z-10 mb-3 flex items-center justify-between gap-2 lg:top-0">
        <span className="rounded-md bg-card/90 px-2.5 py-1 text-[12.5px] text-ink-3 shadow-[var(--shadow-soft)] backdrop-blur tnum" aria-live="polite">
          Page {current} of {sizes.length}
        </span>
        <div className="flex items-center gap-1 rounded-md bg-card/90 p-0.5 shadow-[var(--shadow-soft)] backdrop-blur">
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out" disabled={zoom <= 0.5}>
            <Minus size={15} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm min-w-[3.4rem] tnum" onClick={() => setZoom(1)} title="Fit width">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom in" disabled={zoom >= 3}>
            <Plus size={15} />
          </button>
        </div>
      </div>
      <div className="space-y-4 overflow-x-auto pb-4">
        {sizes.map((s, i) => (
          <PdfPage key={i} pdf={pdf} n={i + 1} size={s} width={pageWidth} spec={spec} onVisible={setCurrent} />
        ))}
      </div>
    </div>
  );
}

function PdfPage({ pdf, n, size, width, spec, onVisible }: { pdf: PDFDocumentProxy; n: number; size: PageSize; width: number; spec: HighlightSpec | null; onVisible: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [rendered, setRendered] = useState(false);
  const scale = width / size.w;
  const height = Math.round(size.h * scale);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const near = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "800px 0px" });
    const seen = new IntersectionObserver(([e]) => e.isIntersecting && onVisible(n), { threshold: 0.5 });
    near.observe(el);
    seen.observe(el);
    return () => {
      near.disconnect();
      seen.disconnect();
    };
  }, [n, onVisible]);

  useEffect(() => {
    if (!near) return;
    const el = ref.current;
    const textEl = textRef.current;
    if (!el || !textEl) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: { cancel: () => void } | null = null;
    const canvas = document.createElement("canvas");
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const page = await pdf.getPage(n);
        if (cancelled) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.setAttribute("aria-hidden", "true");
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
        if (cancelled) return;
        el.querySelector("canvas")?.remove();
        el.prepend(canvas);
        textEl.replaceChildren();
        const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textEl, viewport: page.getViewport({ scale }) });
        textLayer = tl;
        await tl.render();
        if (cancelled) return;
        highlightDom(textEl, spec);
        setRendered(true);
      } catch {
        /* cancelled or unrenderable page: the placeholder stays */
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      canvas.width = canvas.height = 0;
      el.querySelector("canvas")?.remove();
      textEl.replaceChildren();
      setRendered(false);
    };
  }, [near, pdf, n, scale, spec]);

  return (
    <div
      ref={ref}
      id={`pdf-page-${n}`}
      className="pdf-page scroll-mt-16"
      style={{ width, height, ["--scale-factor" as string]: scale }}
      data-rendered={rendered}
    >
      {!rendered && <div className="absolute inset-0 grid place-items-center text-[12px] text-neutral-400">Page {n}</div>}
      <div ref={textRef} className="textLayer" />
    </div>
  );
}
