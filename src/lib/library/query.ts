import type { DocKind, DocumentRecord, ImportantDate } from "@/lib/types";
import { addDays, todayISO, toISODate } from "@/lib/util";

export const UNCATEGORIZED = "__none__";

export type DatePreset = "any" | "7d" | "30d" | "12m" | "custom";

export interface LibraryFilter {
  /** Any of these categories (UNCATEGORIZED = no category). Empty = all. */
  categoryIds: string[];
  /** Documents must have every one of these tags. */
  tagIds: string[];
  kinds: DocKind[];
  /** Only documents whose processing failed or is incomplete. */
  attention: boolean;
  /** Only documents with an active important date. */
  withDates: boolean;
  dateField: "imported" | "document";
  datePreset: DatePreset;
  /** YYYY-MM-DD, inclusive (custom range). */
  from: string;
  to: string;
}

export const EMPTY_FILTER: LibraryFilter = {
  categoryIds: [],
  tagIds: [],
  kinds: [],
  attention: false,
  withDates: false,
  dateField: "imported",
  datePreset: "any",
  from: "",
  to: "",
};

export function isFilterActive(f: LibraryFilter): boolean {
  return !!(f.categoryIds.length || f.tagIds.length || f.kinds.length || f.attention || f.withDates || f.datePreset !== "any");
}

export type SortKey = "relevance" | "imported-desc" | "imported-asc" | "docdate-desc" | "docdate-asc" | "title-asc" | "size-desc";

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Best match",
  "imported-desc": "Recently added",
  "imported-asc": "Oldest added",
  "docdate-desc": "Document date (newest)",
  "docdate-asc": "Document date (oldest)",
  "title-asc": "Title (A–Z)",
  "size-desc": "Largest first",
};

export function needsAttention(d: DocumentRecord): boolean {
  return d.extraction.status === "failed" || d.extraction.status === "partial";
}

function dateRange(f: LibraryFilter, today: string): [string, string] | null {
  switch (f.datePreset) {
    case "any":
      return null;
    case "7d":
      return [addDays(today, -6), today];
    case "30d":
      return [addDays(today, -29), today];
    case "12m":
      return [addDays(today, -364), today];
    case "custom":
      return f.from || f.to ? [f.from || "0000-01-01", f.to || "9999-12-31"] : null;
  }
}

export function filterDocuments(docs: readonly DocumentRecord[], f: LibraryFilter, opts: { dates?: readonly ImportantDate[]; today?: string } = {}): DocumentRecord[] {
  const range = dateRange(f, opts.today ?? todayISO());
  const withDates = f.withDates ? new Set((opts.dates ?? []).filter((d) => d.status === "active").map((d) => d.docId)) : null;
  const cats = new Set(f.categoryIds);
  return docs.filter((d) => {
    if (cats.size && !cats.has(d.categoryId ?? UNCATEGORIZED)) return false;
    if (f.tagIds.length && !f.tagIds.every((t) => d.tagIds.includes(t))) return false;
    if (f.kinds.length && !f.kinds.includes(d.kind)) return false;
    if (f.attention && !needsAttention(d)) return false;
    if (withDates && !withDates.has(d.id)) return false;
    if (range) {
      const v = f.dateField === "imported" ? toISODate(new Date(d.importedAt)) : d.documentDate?.value;
      if (!v || v < range[0] || v > range[1]) return false;
    }
    return true;
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortDocuments(docs: readonly DocumentRecord[], key: SortKey): DocumentRecord[] {
  const out = [...docs];
  const docDate = (d: DocumentRecord) => d.documentDate?.value ?? null;
  const byDocDate = (dir: 1 | -1) => (a: DocumentRecord, b: DocumentRecord) => {
    const x = docDate(a);
    const y = docDate(b);
    if (x === y) return b.importedAt - a.importedAt;
    if (!x) return 1; // undated documents always last
    if (!y) return -1;
    return x < y ? -dir : dir;
  };
  switch (key) {
    case "relevance":
    case "imported-desc":
      return out.sort((a, b) => b.importedAt - a.importedAt || collator.compare(a.title, b.title));
    case "imported-asc":
      return out.sort((a, b) => a.importedAt - b.importedAt || collator.compare(a.title, b.title));
    case "docdate-desc":
      return out.sort(byDocDate(-1));
    case "docdate-asc":
      return out.sort(byDocDate(1));
    case "title-asc":
      return out.sort((a, b) => collator.compare(a.title, b.title) || b.importedAt - a.importedAt);
    case "size-desc":
      return out.sort((a, b) => b.size - a.size || b.importedAt - a.importedAt);
  }
}

/** Counts per category id (UNCATEGORIZED for none) and per tag id. */
export function facetCounts(docs: readonly DocumentRecord[]): { categories: Map<string, number>; tags: Map<string, number> } {
  const categories = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const d of docs) {
    const c = d.categoryId ?? UNCATEGORIZED;
    categories.set(c, (categories.get(c) ?? 0) + 1);
    for (const t of d.tagIds) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  return { categories, tags };
}
