import type { DocumentRecord } from "@/lib/types";
import type { FieldName, IndexableDoc } from "@/lib/search/engine";

let n = 0;

export function makeDoc(over: Partial<DocumentRecord> = {}): DocumentRecord {
  n++;
  const now = 1_760_000_000_000 + n * 1000;
  return {
    id: `doc-${n}`,
    title: `Document ${n}`,
    fileName: `document-${n}.pdf`,
    mimeType: "application/pdf",
    kind: "pdf",
    size: 1000 + n,
    sha256: n.toString(16).padStart(64, "0"),
    fileModifiedAt: null,
    importedAt: now,
    updatedAt: now,
    categoryId: null,
    categorySource: null,
    categoryReasons: [],
    tagIds: [],
    notes: "",
    documentDate: null,
    findings: null,
    extraction: { status: "completed", method: "pdf-text", attempts: 1, updatedAt: now },
    textLength: 0,
    hasPreview: false,
    ...over,
  };
}

export function indexable(id: string, fields: Partial<Record<FieldName, string>>, pageOffsets?: number[]): IndexableDoc {
  return {
    id,
    fields: { title: "", fileName: "", tags: "", category: "", notes: "", meta: "", body: "", ...fields },
    pageOffsets,
  };
}
