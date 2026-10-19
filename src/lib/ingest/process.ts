import type { DocumentRecord, Extraction, PreviewRecord, TextRecord } from "@/lib/types";
import { isAbortError, plural } from "@/lib/util";
import { decodeText } from "./sniff";
import { closePdf, extractPdfText, joinPages, openPdf, pageHasText, passwordProblem, pdfErrorMessage, renderPage, usablePdfTitle } from "./pdf";
import { decodeImage, ocrCanvas, releaseCanvas, thumbnailFrom, PREVIEW_WIDTH } from "./images";
import { recognize, usableOcrText, type OcrProgress } from "./ocr";

/** Scanned pages OCR'd per PDF; beyond this the document is marked partially processed. */
export const OCR_PAGE_LIMIT = 25;

export interface ProcessOptions {
  ocrEnabled: boolean;
  /** For encrypted PDFs; used for this run only and never stored. */
  password?: string;
  signal: AbortSignal;
  onProgress: (label: string, ratio: number | null) => void;
}

export interface ProcessOutput {
  extraction: Omit<Extraction, "attempts" | "updatedAt">;
  text: TextRecord | null;
  preview: PreviewRecord | null;
  /** A meaningful title from the file's own metadata (PDF Title), if any. */
  metaTitle?: string | null;
}

function ocrLabel(p: OcrProgress, what: string): string {
  return p.stage === "loading" ? "Loading text recognition…" : `Recognizing text${what}`;
}

async function processPdf(doc: DocumentRecord, blob: Blob, o: ProcessOptions): Promise<ProcessOutput> {
  o.onProgress("Opening PDF…", null);
  let pdf;
  try {
    pdf = await openPdf(await blob.arrayBuffer(), { transfer: true, password: o.password });
  } catch (e) {
    return { extraction: { status: "failed", method: "none", message: pdfErrorMessage(e), needsPassword: passwordProblem(e) !== null }, text: null, preview: null };
  }
  try {
    const info = (await pdf.getMetadata().catch(() => null))?.info as { Title?: unknown } | undefined;
    const metaTitle = usablePdfTitle(info?.Title);
    const { pages, pageCount } = await extractPdfText(pdf, {
      signal: o.signal,
      onPage: (n, total) => o.onProgress(`Reading page ${n} of ${total}`, (n - 1) / total),
    });

    let preview: PreviewRecord | null = null;
    try {
      const page = await pdf.getPage(1);
      const canvas = await renderPage(page, PREVIEW_WIDTH, o.signal);
      const t = await thumbnailFrom(canvas, canvas.width, canvas.height);
      releaseCanvas(canvas);
      page.cleanup();
      preview = { id: doc.id, ...t };
    } catch (e) {
      if (isAbortError(e)) throw e;
    }

    const missing = pages.map((p, i) => (pageHasText(p) ? -1 : i)).filter((i) => i >= 0);
    let ocrPages = 0;
    let ocrFailed: string | null = null;
    const confidences: number[] = [];
    let cancelled = false;

    if (missing.length && o.ocrEnabled) {
      const todo = missing.slice(0, OCR_PAGE_LIMIT);
      for (let k = 0; k < todo.length; k++) {
        const i = todo[k];
        const what = todo.length > 1 ? ` · page ${i + 1} (${k + 1} of ${todo.length})` : "…";
        try {
          const page = await pdf.getPage(i + 1);
          const canvas = await renderPage(page, 1800, o.signal);
          page.cleanup();
          const r = await recognize(canvas, { signal: o.signal, onProgress: (p) => o.onProgress(ocrLabel(p, what), p.stage === "recognizing" ? (k + p.ratio) / todo.length : null) });
          releaseCanvas(canvas);
          ocrPages++;
          if (usableOcrText(r)) {
            pages[i] = r.text;
            confidences.push(r.confidence);
          }
        } catch (e) {
          if (isAbortError(e)) {
            cancelled = true;
            break;
          }
          ocrFailed = (e as Error).message;
          break;
        }
      }
    }

    const stillMissing = pages.filter((p) => !pageHasText(p)).length;
    const { text, pageOffsets } = joinPages(pages);
    const hasAnyText = text.replace(/\s+/g, "").length > 0;
    const method = confidences.length ? "pdf-ocr" : hasAnyText ? "pdf-text" : "none";
    const ocrConfidence = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : undefined;
    const base = { method, pageCount, pagesWithText: pageCount - stillMissing, ocrConfidence, needsOcr: stillMissing > 0 } as const;
    const textRecord = hasAnyText ? { id: doc.id, text, pageOffsets } : null;

    if (!stillMissing) {
      const note = confidences.length ? `${plural(confidences.length, "scanned page")} read with text recognition${ocrConfidence! < 70 ? " — some words may be misread" : ""}.` : undefined;
      return { extraction: { status: "completed", ...base, message: note }, text: textRecord, preview, metaTitle };
    }

    let message: string;
    if (stillMissing === pageCount && !o.ocrEnabled) message = "This PDF has no text layer — it looks like a scan. Turn on text recognition (OCR) to make it searchable.";
    else if (cancelled) message = "Text recognition was cancelled before every scanned page was read.";
    else if (ocrFailed) message = `${ocrFailed} Scanned pages weren't read.`;
    else if (!o.ocrEnabled) message = `${plural(stillMissing, "page")} of ${pageCount} have no text layer and may be scanned. Turn on text recognition (OCR) to read them.`;
    else if (missing.length > OCR_PAGE_LIMIT && ocrPages === OCR_PAGE_LIMIT)
      message = `Text recognition read the first ${OCR_PAGE_LIMIT} scanned pages; ${plural(stillMissing, "page")} still have no searchable text.`;
    else message = `No readable text was found on ${plural(stillMissing, "page")}, even with text recognition.`;
    return { extraction: { status: "partial", ...base, message }, text: textRecord, preview, metaTitle };
  } finally {
    void closePdf(pdf);
  }
}

async function processImage(doc: DocumentRecord, blob: Blob, o: ProcessOptions): Promise<ProcessOutput> {
  o.onProgress("Opening image…", null);
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(blob);
  } catch (e) {
    return { extraction: { status: "failed", method: "none", message: `${(e as Error).message} The original file is stored unchanged.` }, text: null, preview: null };
  }
  try {
    const t = await thumbnailFrom(bitmap, bitmap.width, bitmap.height);
    const preview: PreviewRecord = { id: doc.id, ...t };
    if (!o.ocrEnabled)
      return {
        extraction: { status: "partial", method: "none", message: "Text recognition (OCR) is off, so this image can be found by its name, tags and notes only." },
        text: null,
        preview,
      };
    const canvas = ocrCanvas(bitmap, bitmap.width, bitmap.height);
    try {
      const r = await recognize(canvas, { signal: o.signal, onProgress: (p) => o.onProgress(ocrLabel(p, "…"), p.stage === "recognizing" ? p.ratio : null) });
      const confidence = Math.round(r.confidence);
      if (!usableOcrText(r))
        return {
          extraction: { status: "partial", method: "ocr", ocrConfidence: confidence, message: "No readable text was found in this image. It can still be found by its name, tags and notes." },
          text: null,
          preview,
        };
      return {
        extraction: { status: "completed", method: "ocr", ocrConfidence: confidence, message: confidence < 70 ? `Read with text recognition (confidence ${confidence}%). Some words may be misread.` : undefined },
        text: { id: doc.id, text: r.text },
        preview,
      };
    } catch (e) {
      if (isAbortError(e)) throw e;
      return { extraction: { status: "failed", method: "none", message: `${(e as Error).message} You can try again.` }, text: null, preview };
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    bitmap.close();
  }
}

async function processText(doc: DocumentRecord, blob: Blob): Promise<ProcessOutput> {
  const text = decodeText(new Uint8Array(await blob.arrayBuffer())).replace(/\r\n?/g, "\n");
  const has = text.trim().length > 0;
  return {
    extraction: has ? { status: "completed", method: "plain" } : { status: "partial", method: "plain", message: "This file contains no text." },
    text: has ? { id: doc.id, text } : null,
    preview: null,
  };
}

/** Reads the text (and a thumbnail) out of a stored file. Never throws for bad files — only for cancellation. */
export async function processFile(doc: DocumentRecord, blob: Blob, o: ProcessOptions): Promise<ProcessOutput> {
  if (doc.kind === "pdf") return processPdf(doc, blob, o);
  if (doc.kind === "image") return processImage(doc, blob, o);
  return processText(doc, blob);
}
