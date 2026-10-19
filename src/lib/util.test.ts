import { describe, expect, it } from "vitest";
import { addDays, daysBetween, fold, formatBytes, parseISODate, safeFileName, titleFromFileName } from "./util";
import { usablePdfTitle } from "./ingest/pdf";

describe("titleFromFileName", () => {
  it("turns file names into readable titles without mangling dates or brands", () => {
    expect(titleFromFileName("Lease-14-Elm-Street.pdf")).toBe("Lease 14 Elm Street");
    expect(titleFromFileName("electric_bill-2026-10.pdf")).toBe("Electric bill 2026-10");
    expect(titleFromFileName("HarborMutual-home-policy.pdf")).toBe("Harbor Mutual home policy");
    expect(titleFromFileName("iPhone receipt.jpg")).toBe("IPhone receipt");
    expect(titleFromFileName("IMG_2041.png")).toBe("IMG 2041");
    expect(titleFromFileName(".pdf")).toBe(".pdf");
  });
});

describe("usablePdfTitle", () => {
  it("accepts real titles and rejects common junk metadata", () => {
    expect(usablePdfTitle("Residential Lease Agreement")).toBe("Residential Lease Agreement");
    expect(usablePdfTitle("  Home   insurance policy ")).toBe("Home insurance policy");
    for (const junk of ["about:blank", "https://example.com/report", "Microsoft Word - Document1.docx", "untitled", "scan0001.pdf", "C:\\Users\\me\\doc.pdf", "1234", "3f2a9c0e-11aa-4b9e-9d1f-0c2b3a4d5e6f", "", null, 42])
      expect(usablePdfTitle(junk)).toBeNull();
  });
});

describe("dates and formatting helpers", () => {
  it("handles calendar dates without time-zone drift", () => {
    expect(parseISODate("2026-02-30")).toBeNull();
    expect(daysBetween("2026-10-18", "2026-11-18")).toBe(31);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // across a DST change in many zones
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("formats sizes and folds accents", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fold("Crème Brûlée")).toBe("creme brulee");
  });
  it("makes safe file names", () => {
    expect(safeFileName('a/b\\c:d*e?"f<g>|h.pdf')).toBe("a_b_c_d_e_f_g_h.pdf");
    expect(safeFileName("...")).toBe("file");
  });
});
