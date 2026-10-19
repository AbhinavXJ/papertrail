import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeText, sha256Hex, sniff } from "./sniff";
import { closePdf, extractPdfText, joinPages, joinTextItems, openPdf, pageHasText, passwordProblem, pdfErrorMessage } from "./pdf";
import { makePdf, flow } from "@/lib/samples/pdf-writer";

const enc = (s: string) => new TextEncoder().encode(s);
const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve("pdfjs-dist/package.json"));
const assets = { standardFontDataUrl: join(pdfjsDir, "standard_fonts") + "/", cMapUrl: join(pdfjsDir, "cmaps") + "/", cMapPacked: true };
const legacy = () => import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<typeof import("pdfjs-dist")>;

describe("sniff", () => {
  it("identifies files by their bytes, not their names", () => {
    expect(sniff(enc("%PDF-1.7\n..."), "scan.bin", 100)).toEqual({ ok: true, kind: "pdf", mime: "application/pdf" });
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "photo.jpg", 100)).toMatchObject({ ok: true, mime: "image/png" });
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "a.jpeg", 100)).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(sniff(enc("RIFF\0\0\0\0WEBPVP8 "), "a.webp", 100)).toMatchObject({ ok: true, mime: "image/webp" });
    expect(sniff(enc("# Notes\nhello"), "notes.md", 100)).toMatchObject({ ok: true, kind: "text", mime: "text/markdown" });
  });

  it("rejects invalid, empty, oversized and unsupported files with a reason", () => {
    expect(sniff(enc("MZ\x90\0binary"), "invoice.pdf", 100)).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't a PDF/) });
    expect(sniff(new Uint8Array(), "a.pdf", 0)).toMatchObject({ ok: false, reason: "This file is empty." });
    expect(sniff(enc("%PDF-1.4"), "big.pdf", 500 * 1024 * 1024)).toMatchObject({ ok: false, reason: expect.stringMatching(/limit/) });
    expect(sniff(enc("PK\x03\x04"), "lease.docx", 100)).toMatchObject({ ok: false, reason: expect.stringMatching(/PDF/) });
    expect(sniff(enc("\0\0\0\x18ftypheic"), "IMG_1.HEIC", 100)).toMatchObject({ ok: false, reason: expect.stringMatching(/HEIC/) });
    expect(sniff(new Uint8Array([1, 2, 0, 4]), "data.txt", 4)).toMatchObject({ ok: false, reason: expect.stringMatching(/binary/) });
    expect(sniff(enc("hello"), "program.exe", 5)).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't supported/) });
  });

  it("decodes UTF-8, UTF-16 and legacy text", () => {
    expect(decodeText(enc("café"))).toBe("café");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]))).toBe("hi");
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });

  it("hashes content with SHA-256", async () => {
    expect(await sha256Hex(enc("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("PDF text extraction", () => {
  it("joins text items using their positions", () => {
    const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10, hasEOL });
    expect(joinTextItems([item("Total", 0, 100, 25), item("$12.00", 40, 100, 30), item("Next", 0, 80, 20), { type: "beginMarkedContent" }, item("line", 21, 80, 20, true)])).toBe("Total $12.00\nNextline");
  });

  it("extracts every page of a real text PDF", async () => {
    const pages = flow([
      { text: "Residential Lease Agreement", size: 18, bold: true },
      { text: "The security deposit is $2,150.00 and is held by the landlord. ".repeat(140) },
      { text: "Rent is due on the first day of each month." },
    ]);
    const bytes = makePdf(pages, { title: "Lease" });
    const pdf = await openPdf(bytes, { pdfjs: await legacy(), assets });
    const r = await extractPdfText(pdf);
    expect(r.pageCount).toBe(pages.length);
    expect(r.pageCount).toBeGreaterThan(1);
    const { text, pageOffsets } = joinPages(r.pages);
    expect(text).toContain("Residential Lease Agreement");
    expect(text).toContain("security deposit is $2,150.00");
    expect(text.slice(pageOffsets[pageOffsets.length - 1])).toContain("Rent is due on the first day");
    expect(r.pages.every(pageHasText)).toBe(true);
    await closePdf(pdf);
  });

  it("writes Unicode metadata titles that pdf.js reads back exactly", async () => {
    const pdf = await openPdf(makePdf([[{ text: "x", y: 700 }]], { title: "Lease agreement — 14 Élm Street" }), { pdfjs: await legacy(), assets });
    const meta = await pdf.getMetadata();
    expect((meta.info as { Title?: string }).Title).toBe("Lease agreement — 14 Élm Street");
    await closePdf(pdf);
  });

  it("reports pages with no text layer and explains damaged or locked PDFs", async () => {
    const pdf = await openPdf(makePdf([[{ rule: true, x1: 10, x2: 100, y: 100 }]]), { pdfjs: await legacy(), assets });
    const r = await extractPdfText(pdf);
    expect(r.pages.map(pageHasText)).toEqual([false]);
    await closePdf(pdf);
    const err = await openPdf(enc("%PDF-1.4\ngarbage"), { pdfjs: await legacy(), assets }).catch((e) => e);
    expect(pdfErrorMessage(err)).toMatch(/damaged|couldn't be read/);
    expect(pdfErrorMessage({ name: "PasswordException" })).toMatch(/password/);
  });

  it("opens encrypted PDFs only with the right password and reports why", async () => {
    for (const name of ["encrypted-aes-128", "encrypted-rc4-40"]) {
      const bytes = new Uint8Array(readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)));
      const locked = await openPdf(bytes, { pdfjs: await legacy(), assets }).catch((e) => e);
      expect(passwordProblem(locked)).toBe("needed");
      expect(pdfErrorMessage(locked)).toMatch(/password-protected/);
      const wrong = await openPdf(bytes, { pdfjs: await legacy(), assets, password: "nope" }).catch((e) => e);
      expect(passwordProblem(wrong)).toBe("wrong");
      expect(pdfErrorMessage(wrong)).toMatch(/didn't open/);
      const pdf = await openPdf(bytes, { pdfjs: await legacy(), assets, password: "user pw" });
      const { pages } = await extractPdfText(pdf);
      expect(pages.join(" ")).toContain("Hello secret world");
      await closePdf(pdf);
    }
    expect(passwordProblem(new Error("x"))).toBeNull();
  });

  it("supports cancellation between pages", async () => {
    const pdf = await openPdf(makePdf([[{ text: "a", y: 700 }], [{ text: "b", y: 700 }]]), { pdfjs: await legacy(), assets });
    const ac = new AbortController();
    ac.abort();
    await expect(extractPdfText(pdf, { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    await closePdf(pdf);
  });
});
