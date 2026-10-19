import type { Category, DocumentRecord, ImportantDate, Tag, TextRecord } from "@/lib/types";
import { categoryName } from "@/lib/organize/categories";
import { DATE_KINDS } from "@/lib/dates/kinds";
import { extensionOf } from "@/lib/util";
import type { IndexableDoc } from "./engine";

const KIND_WORDS: Record<DocumentRecord["kind"], string> = {
  pdf: "pdf document",
  image: "image photo picture scan",
  text: "text note",
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function dateWords(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? "";
  return `${iso} ${y} ${month} ${Number(d)} ${month} ${y}`;
}

export interface IndexContext {
  tags: ReadonlyMap<string, Tag>;
  categories: readonly Category[];
  dates: readonly ImportantDate[];
}

/** Turns stored records into the searchable fields of one document. */
export function toIndexable(doc: DocumentRecord, text: TextRecord | null | undefined, ctx: IndexContext): IndexableDoc {
  const meta: string[] = [KIND_WORDS[doc.kind], extensionOf(doc.fileName), doc.mimeType.split("/")[1] ?? ""];
  if (doc.documentDate) meta.push(dateWords(doc.documentDate.value));
  for (const a of doc.findings?.amounts ?? []) {
    meta.push(a.display, a.value.toFixed(2), Number.isInteger(a.value) ? String(a.value) : String(Math.trunc(a.value)));
  }
  for (const d of ctx.dates) {
    if (d.docId !== doc.id) continue;
    meta.push(DATE_KINDS[d.kind].label, d.note, dateWords(d.date));
  }
  return {
    id: doc.id,
    fields: {
      title: doc.title,
      fileName: doc.fileName.replace(/\.[^.]+$/, ""),
      tags: doc.tagIds.map((t) => ctx.tags.get(t)?.name ?? "").join(" · "),
      category: categoryName(doc.categoryId, ctx.categories) ?? "",
      notes: doc.notes,
      meta: meta.filter(Boolean).join(" · "),
      body: text?.text ?? "",
    },
    pageOffsets: text?.pageOffsets,
  };
}
