import { describe, expect, it } from "vitest";
import { classify, suggestCategory, ruleMatches } from "./classify";
import { dateHint, extractFindings, findAmounts, findDates, primaryAmount, suggestDocumentDate } from "./findings";
import type { Rule } from "@/lib/types";

describe("findDates", () => {
  it("finds ISO, written and numeric dates with hints from nearby words", () => {
    const text = "Invoice date: 2026-03-04\nPayment due: April 15, 2026\nWarranty valid until 15 March 2028\nPrinted 31/12/2025";
    const d = findDates(text, "mdy");
    expect(d.map((x) => [x.date, x.hint])).toEqual([
      ["2026-03-04", "issued"],
      ["2026-04-15", "bill-due"],
      ["2028-03-15", "warranty"],
      ["2025-12-31", null],
    ]);
    expect(d[3].ambiguous).toBe(false);
  });

  it("flags numeric dates that could be read two ways and honours the locale order", () => {
    expect(findDates("Due 03/04/2026", "mdy")[0]).toMatchObject({ date: "2026-03-04", ambiguous: true });
    expect(findDates("Due 03/04/2026", "dmy")[0]).toMatchObject({ date: "2026-04-03", ambiguous: true });
  });

  it("never invents dates from impossible values or other numbers", () => {
    expect(findDates("Feb 30, 2026 and 2026-13-01 and 45/12/2026 and $1,299.00 and 12.5.2")).toEqual([]);
    expect(findDates("Phone 555-12-34")).toEqual([]);
    expect(findDates("")).toEqual([]);
  });

  it("does not report a date nested inside another match twice", () => {
    expect(findDates("Timestamp 2026-05-01T10:00").map((d) => d.date)).toEqual(["2026-05-01"]);
  });

  it("maps context words to date kinds", () => {
    expect(dateHint("Policy renewal date:")).toBe("insurance-renewal");
    expect(dateHint("Your plan renews on")).toBe("subscription-renewal");
    expect(dateHint("Passport expiry date")).toBe("document-expiry");
    expect(dateHint("The lease term ends on")).toBe("agreement-end");
    expect(dateHint("Random words")).toBeNull();
  });
});

describe("findAmounts", () => {
  it("parses symbols, codes and European formats with labels", () => {
    const a = findAmounts("Subtotal $1,180.00\nTax $119.00\nTotal $1,299.00\nDeposit: EUR 450\nPrix 1.234,50 €");
    expect(a.map((x) => [x.value, x.currency, x.label])).toEqual([
      [1180, "USD", "Subtotal"],
      [119, "USD", "Tax"],
      [1299, "USD", "Total"],
      [450, "EUR", "Deposit"],
      [1234.5, "EUR", null],
    ]);
    expect(primaryAmount({ amounts: a, dates: [] })?.value).toBe(1299);
  });

  it("accepts labeled amounts without a currency symbol only when they have cents", () => {
    expect(findAmounts("Total 45.00").map((a) => a.value)).toEqual([45]);
    expect(findAmounts("Total 45 items")).toEqual([]);
  });
});

describe("suggestDocumentDate", () => {
  it("uses an explicitly labeled issue date, or a single unlabeled date, never a guess", () => {
    expect(suggestDocumentDate(extractFindings("Order date: 2026-02-01. Due 2026-03-01"))).toBe("2026-02-01");
    expect(suggestDocumentDate(extractFindings("Something on 2026-02-01"))).toBe("2026-02-01");
    expect(suggestDocumentDate(extractFindings("2026-02-01 and 2026-03-01"))).toBeNull();
    expect(suggestDocumentDate(extractFindings("Due date 2026-03-01"))).toBeNull();
    expect(suggestDocumentDate(null)).toBeNull();
  });
});

describe("classification", () => {
  it("suggests a category with the words that triggered it", () => {
    const s = suggestCategory("scan_0001.pdf", "LIMITED WARRANTY. Serial number C02. This warranty covers defects.");
    expect(s?.categoryId).toBe("warranties");
    expect(s?.reasons[0]).toContain("warranty");
  });

  it("uses whole words only and declines when unsure", () => {
    expect(suggestCategory("current-report.txt", "The current situation is apparent.")).toBeNull();
    expect(suggestCategory("notes.txt", "")).toBeNull();
  });

  it("recognizes common document types", () => {
    expect(suggestCategory("electric-bill.pdf", "Amount due $86.40. Billing period. Meter kWh")?.categoryId).toBe("bills");
    expect(suggestCategory("lease.pdf", "The landlord and tenant agree. Security deposit.")?.categoryId).toBe("property");
    expect(suggestCategory("policy.pdf", "Insurance policy number. Policyholder. Premium. Deductible.")?.categoryId).toBe("insurance");
    expect(suggestCategory("boarding.pdf", "Boarding pass. Flight TP 1351. Booking reference XY12.")?.categoryId).toBe("identity");
  });

  const rule = (over: Partial<Rule>): Rule => ({ id: "r", field: "anywhere", contains: "acme", categoryId: "financial", tagId: null, createdAt: 1, ...over });

  it("applies user rules before heuristics and never overrides a manual choice", () => {
    const input = { fileName: "ACME-receipt.pdf", text: "Receipt. Total $5.00. Thank you for your purchase.", rules: [rule({ tagId: "t1" })] };
    expect(classify(input)).toMatchObject({ categoryId: "financial", categorySource: "rule", tagIds: ["t1"] });
    expect(classify({ ...input, rules: [] })).toMatchObject({ categoryId: "receipts", categorySource: "suggested" });
    expect(classify(input, { categoryId: "other", categorySource: "user" })).toMatchObject({ categoryId: "other", categorySource: "user", tagIds: ["t1"] });
  });

  it("matches rules by field, ignoring case and accents", () => {
    expect(ruleMatches(rule({ field: "filename", contains: "Café" }), "cafe-receipt.jpg", "")).toBe(true);
    expect(ruleMatches(rule({ field: "filename", contains: "acme" }), "x.pdf", "acme")).toBe(false);
    expect(ruleMatches(rule({ field: "text", contains: "acme" }), "x.pdf", "ACME corp")).toBe(true);
    expect(ruleMatches(rule({ contains: "  " }), "x", "x")).toBe(false);
  });
});
