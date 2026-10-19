// Domain model for PAPERTRAIL. Everything here is persisted in IndexedDB (see lib/db/schema.ts)
// and written to backups (see lib/backup/manifest.ts). Change with care: bump DB_VERSION and
// BACKUP_VERSION and add a migration when a persisted shape changes.

export type DocKind = "pdf" | "image" | "text";

/**
 * queued      stored, waiting for text extraction
 * processing  text extraction running
 * completed   everything that should have run, ran
 * partial     stored and usable, but some text could not be read (scan without OCR, OCR off, page limit…)
 * failed      stored, but text extraction failed — retry is possible
 */
export type ExtractionStatus = "queued" | "processing" | "completed" | "partial" | "failed";
export type ExtractionMethod = "pdf-text" | "pdf-ocr" | "ocr" | "plain" | "none";

export interface Extraction {
  status: ExtractionStatus;
  method: ExtractionMethod;
  /** Plain-language note shown to the user (never contains document content). */
  message?: string;
  pageCount?: number;
  pagesWithText?: number;
  /** Mean OCR confidence 0–100, when OCR ran. */
  ocrConfidence?: number;
  /** True when the PDF has pages without a text layer (likely a scan). */
  needsOcr?: boolean;
  /** The PDF is encrypted; its text can be read once the user enters the password (never stored). */
  needsPassword?: boolean;
  attempts: number;
  updatedAt: number;
}

export type CategorySource = "user" | "rule" | "suggested";

export interface FoundAmount {
  /** Amount in major units, e.g. 1299.0 */
  value: number;
  currency: string | null;
  /** As printed, e.g. "$1,299.00" */
  display: string;
  /** Nearby label such as "Total" or "Amount due", if any. */
  label: string | null;
}

export interface FoundDate {
  /** YYYY-MM-DD */
  date: string;
  /** As printed, e.g. "12/03/2026" */
  display: string;
  /** Up to ~60 characters of surrounding text (document content, shown only in the UI). */
  context: string;
  /** What the surrounding words suggest. Never treated as confirmed. */
  hint: DateKind | "issued" | null;
  /** Numeric dates like 03/04/2026 can be read two ways. */
  ambiguous: boolean;
}

/** Values found in the text by local pattern matching. Always shown as unverified suggestions. */
export interface Findings {
  amounts: FoundAmount[];
  dates: FoundDate[];
}

export interface DocumentDate {
  /** YYYY-MM-DD */
  value: string;
  source: "user" | "suggested";
}

export interface DocumentRecord {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  kind: DocKind;
  size: number;
  sha256: string;
  /** File.lastModified at import, when the browser provided it. */
  fileModifiedAt: number | null;
  importedAt: number;
  updatedAt: number;
  categoryId: string | null;
  categorySource: CategorySource | null;
  /** Why a rule/suggestion picked the category, e.g. ['mentions "warranty"']. */
  categoryReasons: string[];
  tagIds: string[];
  notes: string;
  documentDate: DocumentDate | null;
  findings: Findings | null;
  extraction: Extraction;
  /** Characters of extracted text (0 when none). */
  textLength: number;
  hasPreview: boolean;
}

export interface TextRecord {
  id: string;
  text: string;
  /** Character offset where each page starts (PDFs only). */
  pageOffsets?: number[];
}

export interface FileRecord {
  id: string;
  blob: Blob;
}

/**
 * How binary data is persisted: a Blob where the browser supports storing Blobs in IndexedDB,
 * otherwise (Safari Private Browsing, some embedded WebKit views) the bytes plus their MIME type.
 */
export interface StoredBinary {
  blob?: Blob;
  data?: ArrayBuffer;
  type?: string;
}

export interface PreviewRecord {
  id: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}

export interface Category {
  id: string;
  name: string;
  builtIn: boolean;
  createdAt: number;
}

export type RuleField = "filename" | "text" | "anywhere";

export interface Rule {
  id: string;
  field: RuleField;
  /** Case- and accent-insensitive substring. */
  contains: string;
  categoryId: string | null;
  tagId: string | null;
  createdAt: number;
}

export type DateKind =
  | "warranty"
  | "insurance-renewal"
  | "agreement-end"
  | "bill-due"
  | "subscription-renewal"
  | "document-expiry"
  | "other";

export type DateStatus = "active" | "done" | "dismissed";

export interface ImportantDate {
  id: string;
  docId: string;
  kind: DateKind;
  /** YYYY-MM-DD (a calendar date, no time zone) */
  date: string;
  /** Free text, e.g. "AppleCare+" */
  note: string;
  /** Days before `date` to start reminding; null = no reminder. */
  remindDays: number | null;
  status: DateStatus;
  createdAt: number;
  updatedAt: number;
  /** Reminder key last shown as a browser notification (prevents repeats). */
  notifiedKey: string | null;
}

export interface Settings {
  ocrEnabled: boolean;
  notificationsEnabled: boolean;
  lastBackupAt: number | null;
  /** When the user last dismissed the "back up your library" reminder. */
  backupNudgeDismissedAt: number | null;
  view: "list" | "grid";
}

export const DEFAULT_SETTINGS: Settings = {
  ocrEnabled: true,
  notificationsEnabled: false,
  lastBackupAt: null,
  backupNudgeDismissedAt: null,
  view: "list",
};
