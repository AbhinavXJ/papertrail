import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, UNCATEGORIZED, facetCounts, filterDocuments, isFilterActive, sortDocuments } from "./query";
import { makeDoc } from "@/test/fixtures";

const day = 86_400_000;
const now = new Date(2026, 9, 18, 12).getTime();
const docs = [
  makeDoc({ id: "a", title: "Zebra lease", categoryId: "property", tagIds: ["home"], kind: "pdf", importedAt: now - 2 * day, size: 10, documentDate: { value: "2025-01-01", source: "user" } }),
  makeDoc({ id: "b", title: "apple receipt", categoryId: "receipts", tagIds: ["home", "tax"], kind: "image", importedAt: now - 40 * day, size: 300 }),
  makeDoc({ id: "c", title: "Bill 10", categoryId: null, tagIds: [], kind: "text", importedAt: now - 1 * day, size: 50, documentDate: { value: "2026-09-01", source: "suggested" } }),
  makeDoc({ id: "d", title: "Bill 9", categoryId: "receipts", tagIds: ["tax"], kind: "pdf", importedAt: now - 400 * day, size: 20, extraction: { status: "failed", method: "none", attempts: 1, updatedAt: 0 } }),
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("filterDocuments", () => {
  it("filters by category (including uncategorized)", () => {
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, categoryIds: ["receipts"] }))).toEqual(["b", "d"]);
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, categoryIds: [UNCATEGORIZED, "property"] }))).toEqual(["a", "c"]);
  });

  it("requires every selected tag", () => {
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, tagIds: ["home"] }))).toEqual(["a", "b"]);
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, tagIds: ["home", "tax"] }))).toEqual(["b"]);
  });

  it("filters by type, attention and date ranges", () => {
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, kinds: ["pdf"] }))).toEqual(["a", "d"]);
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, attention: true }))).toEqual(["d"]);
    const today = "2026-10-18";
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, datePreset: "7d" }, { today }))).toEqual(["a", "c"]);
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, datePreset: "12m" }, { today }))).toEqual(["a", "b", "c"]);
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, dateField: "document", datePreset: "custom", from: "2026-01-01", to: "" }, { today }))).toEqual(["c"]);
  });

  it("filters to documents with active important dates", () => {
    const dates = [
      { id: "1", docId: "b", kind: "warranty", date: "2027-01-01", note: "", remindDays: 1, status: "active", createdAt: 1, updatedAt: 1, notifiedKey: null },
      { id: "2", docId: "a", kind: "warranty", date: "2027-01-01", note: "", remindDays: 1, status: "dismissed", createdAt: 1, updatedAt: 1, notifiedKey: null },
    ] as const;
    expect(ids(filterDocuments(docs, { ...EMPTY_FILTER, withDates: true }, { dates: [...dates] }))).toEqual(["b"]);
  });

  it("knows when a filter is active", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, kinds: ["pdf"] })).toBe(true);
  });
});

describe("sortDocuments", () => {
  it("sorts by import date, title (natural, case-insensitive), size and document date", () => {
    expect(ids(sortDocuments(docs, "imported-desc"))).toEqual(["c", "a", "b", "d"]);
    expect(ids(sortDocuments(docs, "imported-asc"))).toEqual(["d", "b", "a", "c"]);
    expect(ids(sortDocuments(docs, "title-asc"))).toEqual(["b", "d", "c", "a"]);
    expect(ids(sortDocuments(docs, "size-desc"))).toEqual(["b", "c", "d", "a"]);
    expect(ids(sortDocuments(docs, "docdate-desc"))).toEqual(["c", "a", "b", "d"]);
    expect(ids(sortDocuments(docs, "docdate-asc"))).toEqual(["a", "c", "b", "d"]);
  });
  it("does not mutate its input", () => {
    const copy = [...docs];
    sortDocuments(docs, "title-asc");
    expect(docs).toEqual(copy);
  });
});

describe("facetCounts", () => {
  it("counts categories and tags", () => {
    const f = facetCounts(docs);
    expect(f.categories.get("receipts")).toBe(2);
    expect(f.categories.get(UNCATEGORIZED)).toBe(1);
    expect(f.tags.get("tax")).toBe(2);
  });
});
