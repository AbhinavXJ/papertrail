import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { abortError } from "@/lib/util";

type PdfJs = typeof import("pdfjs-dist");

/** pdf.js and everything it needs are served from this site (copied by scripts/copy-vendor.mjs). */
export const PDF_ASSETS = {
  cMapUrl: "/vendor/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
  wasmUrl: "/vendor/pdfjs/wasm/",
  iccUrl: "/vendor/pdfjs/iccs/",
} as const;

let loader: Promise<PdfJs> | null = null;

/** Lazily loads pdf.js (≈1 MB) only when a PDF is imported or opened. */
export function loadPdfJs(): Promise<PdfJs> {
  loader ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  return loader;
}

/**
 * pdf.js transfers the buffer it is given to its worker. By default a copy is passed; pass
 * `transfer: true` when the caller won't use `data` again (avoids doubling memory for big PDFs).
 */
export async function openPdf(data: ArrayBuffer | Uint8Array, opts: { pdfjs?: PdfJs; assets?: Record<string, unknown>; transfer?: boolean; password?: string } = {}): Promise<PDFDocumentProxy> {
  const lib = opts.pdfjs ?? (await loadPdfJs());
  const bytes = opts.transfer ? (data instanceof Uint8Array ? data : new Uint8Array(data)) : data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  return lib.getDocument({ data: bytes, ...(opts.assets ?? PDF_ASSETS), enableXfa: false, ...(opts.password ? { password: opts.password } : {}) }).promise;
}

/** Releases the document and its worker-side resources (pdf.js 6: owned by the loading task). */
export function closePdf(pdf: PDFDocumentProxy): Promise<void> {
  return pdf.loadingTask.destroy().catch(() => undefined);
}

/**
 * The Title stored in a PDF's metadata, if it looks like a real title. Many PDFs carry junk
 * here ("Microsoft Word - doc1.docx", "untitled", a file path), which is rejected.
 */
export function usablePdfTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 4 || t.length > 120) return null;
  if (!/\p{L}{2}/u.test(t)) return null;
  if (/^(untitled|document\d*|new document|doc\d*|title|print|scan\d*|presentation|powerpoint presentation|slide \d+)$/i.test(t)) return null;
  if (/^microsoft (word|excel|powerpoint)\b/i.test(t) || /^(adobe|acrobat)\b/i.test(t)) return null;
  if (/\.(docx?|pdf|xlsx?|pptx?|txt|rtf|odt|pages|indd|ai|psd|html?|jpe?g|png|tiff?)$/i.test(t)) return null;
  if (/[\\/]/.test(t) && /\.[a-z0-9]{2,4}\b/i.test(t)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null; // about:blank, file://…, https://…
  if (/^[0-9a-f-]{16,}$/i.test(t)) return null;
  return t;
}

/** "needed": the PDF is encrypted; "wrong": a password was given but rejected. */
export function passwordProblem(e: unknown): "needed" | "wrong" | null {
  const err = e as { name?: string; code?: number } | null;
  if (err?.name !== "PasswordException") return null;
  return err.code === 2 ? "wrong" : "needed";
}

/** A user-facing explanation for a pdf.js failure. */
export function pdfErrorMessage(e: unknown): string {
  const pw = passwordProblem(e);
  if (pw === "wrong") return "That password didn't open this PDF. Check it and try again.";
  if (pw === "needed") return "This PDF is password-protected. Enter its password to read its text — the password is never saved.";
  const name = (e as { name?: string } | null)?.name;
  if (name === "InvalidPDFException") return "This PDF appears to be damaged and couldn't be read. The original file is stored unchanged.";
  if (name === "AbortError") return "Text reading was cancelled.";
  return "This PDF couldn't be read. The original file is stored unchanged.";
}

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Joins pdf.js text items into readable lines, inserting spaces and line breaks from their positions. */
export function joinTextItems(items: ReadonlyArray<unknown>): string {
  let out = "";
  let last: { x2: number; y: number; h: number } | null = null;
  for (const it of items) {
    if (!it || typeof it !== "object" || !("str" in it)) continue;
    const item = it as RawItem;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const h = Math.abs(item.transform[3] ?? 0) || item.height || 10;
    if (last && item.str) {
      if (Math.abs(y - last.y) > Math.max(h, last.h) * 0.6) out += "\n";
      else if (x - last.x2 > h * 0.12 && !/\s$/.test(out) && !/^\s/.test(item.str)) out += " ";
    }
    out += item.str;
    if (item.hasEOL) {
      out += "\n";
      last = null;
    } else if (item.str) last = { x2: x + item.width, y, h };
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  return joinTextItems(content.items);
}

/** Non-whitespace characters needed before a page counts as having a text layer. */
export const MIN_PAGE_CHARS = 16;

export function pageHasText(text: string): boolean {
  return text.replace(/\s+/g, "").length >= MIN_PAGE_CHARS;
}

export interface PdfTextResult {
  pages: string[];
  pageCount: number;
}

export async function extractPdfText(pdf: PDFDocumentProxy, opts: { signal?: AbortSignal; onPage?: (n: number, total: number) => void } = {}): Promise<PdfTextResult> {
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (opts.signal?.aborted) throw abortError();
    opts.onPage?.(n, pdf.numPages);
    const page = await pdf.getPage(n);
    try {
      pages.push(await pageText(page));
    } catch {
      pages.push("");
    } finally {
      page.cleanup();
    }
  }
  return { pages, pageCount: pdf.numPages };
}

/** Concatenates page texts and records where each page starts. */
export function joinPages(pages: readonly string[]): { text: string; pageOffsets: number[] } {
  const pageOffsets: number[] = [];
  let text = "";
  pages.forEach((p, i) => {
    if (i > 0) text += "\n\n";
    pageOffsets.push(text.length);
    text += p;
  });
  return { text, pageOffsets };
}

/** Renders a page into a new canvas `width` CSS pixels wide (browser only). */
export async function renderPage(page: PDFPageProxy, width: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, width / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const task = page.render({ canvas, viewport });
  const onAbort = () => task.cancel();
  signal?.addEventListener("abort", onAbort);
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return canvas;
}
