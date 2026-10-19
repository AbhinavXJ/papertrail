import type { DocKind } from "@/lib/types";
import { extensionOf, formatBytes } from "@/lib/util";

export const SNIFF_BYTES = 64 * 1024;

export const MAX_SIZE: Record<DocKind, number> = {
  pdf: 200 * 1024 * 1024,
  image: 40 * 1024 * 1024,
  text: 10 * 1024 * 1024,
};

export const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.txt,.text,.md,.markdown,.csv,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/markdown,text/csv";
export const SUPPORTED_LABEL = "PDF, JPEG, PNG, WebP, TXT, Markdown and CSV";

const TEXT_EXT = new Set(["txt", "text", "md", "markdown", "csv"]);

const UNSUPPORTED: Array<[RegExp, string]> = [
  [/^(docx?|odt|rtf|pages)$/, "Word processor files can't be read in the browser. Save or export it as a PDF, then import the PDF."],
  [/^(xlsx?|ods|numbers)$/, "Spreadsheets can't be read here. Export it as PDF or CSV, then import that."],
  [/^(pptx?|odp|key)$/, "Presentations can't be read here. Export it as a PDF, then import the PDF."],
  [/^(heic|heif)$/, "HEIC photos can't be shown by most browsers. Export the photo as JPEG (on iPhone: Settings → Camera → Formats → Most Compatible) and import it again."],
  [/^(tiff?|bmp|gif)$/, "This image format isn't supported. Convert it to JPEG or PNG first."],
  [/^zip$/, "To restore a PAPERTRAIL backup, open Settings → Backup & restore."],
  [/^(eml|msg)$/, "Email files aren't supported. Print the email to PDF and import the PDF."],
];

export type SniffResult = { ok: true; kind: DocKind; mime: string } | { ok: false; reason: string };

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  return sig.every((x, i) => b[offset + i] === x);
}

function ascii(b: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...b.subarray(start, start + len));
}

export function textMime(ext: string): string {
  return ext === "md" || ext === "markdown" ? "text/markdown" : ext === "csv" ? "text/csv" : "text/plain";
}

/** Decodes text, honouring UTF-8/UTF-16 byte-order marks; falls back to Windows-1252 for legacy files. */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function looksLikeText(head: Uint8Array): boolean {
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return true;
  let control = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) control++;
  }
  return control <= Math.max(2, head.length * 0.01);
}

/**
 * Identifies a file from its first bytes (never just its name) and checks size limits.
 * `head` should be the first SNIFF_BYTES of the file.
 */
export function sniff(head: Uint8Array, name: string, size: number): SniffResult {
  const ext = extensionOf(name);
  if (size === 0) return { ok: false, reason: "This file is empty." };

  let kind: DocKind | null = null;
  let mime = "";
  // %PDF- may be preceded by a little junk; readers accept it within the first 1 KB.
  const pdfAt = ascii(head, 0, Math.min(head.length, 1024)).indexOf("%PDF-");
  if (pdfAt >= 0) [kind, mime] = ["pdf", "application/pdf"];
  else if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) [kind, mime] = ["image", "image/png"];
  else if (startsWith(head, [0xff, 0xd8, 0xff])) [kind, mime] = ["image", "image/jpeg"];
  else if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") [kind, mime] = ["image", "image/webp"];
  else if (ascii(head, 4, 4) === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(ascii(head, 8, 4)))
    return { ok: false, reason: UNSUPPORTED.find(([re]) => re.test("heic"))![1] };
  else if (TEXT_EXT.has(ext) && looksLikeText(head)) [kind, mime] = ["text", textMime(ext)];

  if (!kind) {
    const known = UNSUPPORTED.find(([re]) => re.test(ext));
    if (known) return { ok: false, reason: known[1] };
    if (ext === "pdf") return { ok: false, reason: "This file is named .pdf but isn't a PDF. It may be damaged or only partly downloaded." };
    if (["jpg", "jpeg", "png", "webp"].includes(ext)) return { ok: false, reason: "This file is named like an image but its contents aren't a valid image." };
    if (TEXT_EXT.has(ext)) return { ok: false, reason: "This file contains binary data, not text." };
    return { ok: false, reason: `This file type isn't supported. PAPERTRAIL accepts ${SUPPORTED_LABEL}.` };
  }
  if (size > MAX_SIZE[kind]) return { ok: false, reason: `This file is ${formatBytes(size)}. The limit for ${kind === "pdf" ? "PDFs" : kind === "image" ? "images" : "text files"} is ${formatBytes(MAX_SIZE[kind])}.` };
  return { ok: true, kind, mime };
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
