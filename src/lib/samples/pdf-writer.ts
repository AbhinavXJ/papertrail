/**
 * Writes simple, valid text PDFs (PDF 1.4, standard Helvetica fonts, WinAnsi encoding).
 * Used to generate the sample workspace and test fixtures — the output has a real text
 * layer, so it goes through exactly the same pdf.js extraction as a user's PDF.
 */

export interface PdfLine {
  text: string;
  x?: number;
  y: number;
  size?: number;
  bold?: boolean;
  /** Gray level 0 (black) – 1 (white). */
  gray?: number;
}

export interface PdfRule {
  rule: true;
  x1: number;
  x2: number;
  y: number;
  gray?: number;
}

export type PdfItem = PdfLine | PdfRule;

const WIN_ANSI: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "•": 0x95, "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "™": 0x99 };

function pdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code >= 32 && code < 127) out += ch;
    else if (code < 256) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return `(${out})`;
}

/** Text strings outside page content (e.g. /Title) use PDFDocEncoding or UTF-16BE; UTF-16BE covers everything. */
function pdfTextString(s: string): string {
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

function content(items: readonly PdfItem[]): string {
  const ops: string[] = [];
  for (const it of items) {
    if ("rule" in it) {
      ops.push(`${it.gray ?? 0.8} G 0.6 w ${it.x1} ${it.y} m ${it.x2} ${it.y} l S`);
      continue;
    }
    ops.push(`BT /${it.bold ? "F2" : "F1"} ${it.size ?? 10.5} Tf ${it.gray ?? 0.1} g ${it.x ?? 64} ${it.y} Td ${pdfString(it.text)} Tj ET`);
  }
  return ops.join("\n");
}

export function makePdf(pages: ReadonlyArray<readonly PdfItem[]>, opts: { title?: string; width?: number; height?: number } = {}): Uint8Array<ArrayBuffer> {
  const W = opts.width ?? 612;
  const H = opts.height ?? 792;
  const objects: string[] = [];
  /** Appends an object and returns its (1-based) object number. */
  const add = (body: string) => objects.push(body);
  const catalog = add("");
  const pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Producer (PAPERTRAIL sample generator) ${opts.title ? `/Title ${pdfTextString(opts.title)}` : ""} >>`);
  const kids: number[] = [];
  for (const items of pages) {
    const stream = content(items);
    const contentObj = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentObj} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character above is < 256, so one char == one byte.
  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** Lays out paragraphs top-to-bottom with simple word wrapping; returns pages of lines. */
export function flow(blocks: ReadonlyArray<{ text: string; size?: number; bold?: boolean; gap?: number; gray?: number } | { rule: true }>, opts: { top?: number; bottom?: number; left?: number; width?: number } = {}): PdfItem[][] {
  const top = opts.top ?? 720;
  const bottom = opts.bottom ?? 72;
  const left = opts.left ?? 64;
  const width = opts.width ?? 484;
  const pages: PdfItem[][] = [[]];
  let y = top;
  const newPage = () => {
    pages.push([]);
    y = top;
  };
  for (const b of blocks) {
    if ("rule" in b) {
      y -= 6;
      pages[pages.length - 1].push({ rule: true, x1: left, x2: left + width, y });
      y -= 12;
      continue;
    }
    const size = b.size ?? 10.5;
    const lineH = size * 1.42;
    const maxChars = Math.max(10, Math.floor(width / (size * 0.5)));
    const lines: string[] = [];
    for (const para of b.text.split("\n")) {
      let cur = "";
      for (const w of para.split(/\s+/)) {
        if (cur && (cur + " " + w).length > maxChars) {
          lines.push(cur);
          cur = w;
        } else cur = cur ? `${cur} ${w}` : w;
      }
      lines.push(cur);
    }
    for (const line of lines) {
      if (y - lineH < bottom) newPage();
      y -= lineH;
      if (line) pages[pages.length - 1].push({ text: line, x: left, y: Math.round(y), size, bold: b.bold, gray: b.gray });
    }
    y -= b.gap ?? size * 0.6;
  }
  return pages;
}
