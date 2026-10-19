import type { DB } from "@/lib/db/schema";
import { getFile, getPreview, getText, isQuotaError, listCategories, listDates, listDocuments, listRules, listTags, packBlob, settle, toStorageError, withBlobFallback } from "@/lib/db/repo";
import type { Category, DateKind, DocKind, DocumentRecord, ExtractionStatus, ImportantDate, Rule, Tag } from "@/lib/types";
import { BUILT_IN_IDS } from "@/lib/organize/categories";
import { sha256Hex, sniff, SNIFF_BYTES } from "@/lib/ingest/sniff";
import { fold, newId, safeFileName } from "@/lib/util";
import { crc32Blob, createZip, ZipError, ZipReader, type ZipInput } from "./zip";

/**
 * Backup format v1 — a plain ZIP that any unzip tool can open:
 *
 *   README.txt
 *   manifest.json                     metadata for everything below (see `Manifest`)
 *   documents/<id>/<original name>    the original file, byte for byte
 *   documents/<id>/text.txt           extracted text (so OCR doesn't have to run again)
 *   documents/<id>/preview.jpg        thumbnail
 *
 * Every original's SHA-256 is recorded in the manifest and verified before restoring.
 */
export const BACKUP_FORMAT = "papertrail-backup";
export const BACKUP_VERSION = 1;
export const APP_VERSION = "1.0.0";

export interface ManifestDocument extends Omit<DocumentRecord, "hasPreview"> {
  files: { original: string; text?: string; preview?: string };
  pageOffsets?: number[];
  preview?: { width: number; height: number };
}

export interface Manifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  app: string;
  scope: "library" | "selection";
  documents: ManifestDocument[];
  tags: Tag[];
  categories: Category[];
  rules: Rule[];
  dates: ImportantDate[];
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

const README = `This is a PAPERTRAIL backup.

Your original files are in the "documents" folder, unchanged, one folder per document.
manifest.json holds titles, tags, notes, categories and important dates.

To restore: open PAPERTRAIL, go to Settings → Backup & restore, and choose this file.
Keep this file somewhere safe — it is not encrypted.
`;

// ── Export ─────────────────────────────────────────────────────────────────

export interface ExportResult {
  blob: Blob;
  documents: number;
  /** Documents left out because their stored file was missing. */
  skipped: string[];
}

export async function buildBackup(db: DB, opts: { ids?: readonly string[]; onProgress?: (ratio: number) => void; now?: Date } = {}): Promise<ExportResult> {
  const [allDocs, tags, categories, rules, allDates] = await Promise.all([listDocuments(db), listTags(db), listCategories(db), listRules(db), listDates(db)]);
  const wanted = opts.ids ? new Set(opts.ids) : null;
  const docs = wanted ? allDocs.filter((d) => wanted.has(d.id)) : allDocs;
  docs.sort((a, b) => a.importedAt - b.importedAt);
  const inputs: ZipInput[] = [];
  const manifestDocs: ManifestDocument[] = [];
  const skipped: string[] = [];
  const totalBytes = docs.reduce((s, d) => s + d.size, 0) || 1;
  let readBytes = 0;
  for (const doc of docs) {
    const blob = await getFile(db, doc.id).catch(() => null);
    // Read every original once up front (checksum): a file the browser can no longer read is
    // left out and reported, instead of breaking the whole backup.
    let crc: number | undefined;
    try {
      if (blob) crc = await crc32Blob(blob, (n) => opts.onProgress?.(Math.min(0.98, (readBytes += n) / totalBytes)));
    } catch {
      crc = undefined;
    }
    if (!blob || crc === undefined) {
      skipped.push(doc.title);
      continue;
    }
    const dir = `documents/${doc.id}`;
    const original = `${dir}/${safeFileName(doc.fileName, `original.${doc.kind}`)}`;
    const files: ManifestDocument["files"] = { original };
    const modified = new Date(doc.fileModifiedAt ?? doc.importedAt);
    inputs.push({ name: original, data: blob, modified, crc });
    const text = await getText(db, doc.id);
    if (text?.text) {
      files.text = `${dir}/text.txt`;
      inputs.push({ name: files.text, data: text.text, modified: new Date(doc.updatedAt) });
    }
    const preview = doc.hasPreview ? await getPreview(db, doc.id) : null;
    if (preview) {
      files.preview = `${dir}/preview.jpg`;
      inputs.push({ name: files.preview, data: preview.blob, modified: new Date(doc.updatedAt) });
    }
    const { hasPreview: _omit, ...rest } = doc;
    void _omit;
    manifestDocs.push({ ...rest, files, pageOffsets: text?.pageOffsets, preview: preview ? { width: preview.width, height: preview.height } : undefined });
  }
  const included = new Set(manifestDocs.map((d) => d.id));
  const usedTags = new Set(manifestDocs.flatMap((d) => d.tagIds));
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (opts.now ?? new Date()).toISOString(),
    app: `papertrail@${APP_VERSION}`,
    scope: wanted ? "selection" : "library",
    documents: manifestDocs,
    tags: wanted ? tags.filter((t) => usedTags.has(t.id)) : tags,
    categories,
    rules: wanted ? [] : rules,
    dates: allDates.filter((d) => included.has(d.docId)),
  };
  const blob = await createZip(
    [{ name: "README.txt", data: README }, { name: "manifest.json", data: JSON.stringify(manifest, null, 1) }, ...inputs],
  );
  opts.onProgress?.(1);
  return { blob, documents: manifestDocs.length, skipped };
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `papertrail-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
}

// ── Validation ─────────────────────────────────────────────────────────────

const KINDS: DocKind[] = ["pdf", "image", "text"];
const STATUSES: ExtractionStatus[] = ["queued", "processing", "completed", "partial", "failed"];
const DATE_KINDS: DateKind[] = ["warranty", "insurance-renewal", "agreement-end", "bill-due", "subscription-renewal", "document-expiry", "other"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isISO = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);
const safePath = (p: unknown): p is string => isStr(p) && p.startsWith("documents/") && !p.split("/").includes("..");

/** Validates one manifest document; returns a clean record or the reason it is unusable. */
export function checkManifestDocument(raw: unknown): ManifestDocument | string {
  if (!isObj(raw)) return "its metadata is missing";
  const { id, title, fileName, mimeType, kind, size, sha256, importedAt, files } = raw;
  if (!isStr(id) || !id || id.length > 100) return "it has no valid id";
  if (!isStr(fileName) || !isStr(mimeType)) return "its file name or type is missing";
  if (!KINDS.includes(kind as DocKind)) return "its document type is unknown";
  if (!isNum(size) || size < 0) return "its size is invalid";
  if (!isStr(sha256) || !/^[0-9a-f]{64}$/.test(sha256)) return "its checksum is missing";
  if (!isObj(files) || !safePath(files.original)) return "its original file isn't referenced";
  const ex = isObj(raw.extraction) ? raw.extraction : {};
  const status = STATUSES.includes(ex.status as ExtractionStatus) ? (ex.status as ExtractionStatus) : "completed";
  const dd = isObj(raw.documentDate) && isISO(raw.documentDate.value) ? { value: raw.documentDate.value, source: raw.documentDate.source === "user" ? ("user" as const) : ("suggested" as const) } : null;
  const findings = isObj(raw.findings) && Array.isArray(raw.findings.dates) && Array.isArray(raw.findings.amounts) ? (raw.findings as unknown as ManifestDocument["findings"]) : null;
  const pageOffsets = Array.isArray(raw.pageOffsets) && raw.pageOffsets.every(isNum) ? (raw.pageOffsets as number[]) : undefined;
  const preview = isObj(raw.preview) && isNum(raw.preview.width) && isNum(raw.preview.height) ? { width: raw.preview.width, height: raw.preview.height } : undefined;
  const at = isNum(importedAt) ? importedAt : Date.now();
  return {
    id,
    title: isStr(title) && title.trim() ? title : fileName,
    fileName,
    mimeType,
    kind: kind as DocKind,
    size,
    sha256,
    fileModifiedAt: isNum(raw.fileModifiedAt) ? raw.fileModifiedAt : null,
    importedAt: at,
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : at,
    categoryId: isStr(raw.categoryId) ? raw.categoryId : null,
    categorySource: raw.categorySource === "user" || raw.categorySource === "rule" || raw.categorySource === "suggested" ? raw.categorySource : null,
    categoryReasons: strArray(raw.categoryReasons),
    tagIds: strArray(raw.tagIds),
    notes: isStr(raw.notes) ? raw.notes : "",
    documentDate: dd,
    findings,
    extraction: {
      status,
      method: isStr(ex.method) ? (ex.method as DocumentRecord["extraction"]["method"]) : "none",
      message: isStr(ex.message) ? ex.message : undefined,
      pageCount: isNum(ex.pageCount) ? ex.pageCount : undefined,
      pagesWithText: isNum(ex.pagesWithText) ? ex.pagesWithText : undefined,
      ocrConfidence: isNum(ex.ocrConfidence) ? ex.ocrConfidence : undefined,
      needsOcr: ex.needsOcr === true,
      needsPassword: ex.needsPassword === true,
      attempts: 0,
      updatedAt: isNum(ex.updatedAt) ? ex.updatedAt : at,
    },
    textLength: isNum(raw.textLength) ? raw.textLength : 0,
    files: { original: files.original, text: safePath(files.text) ? files.text : undefined, preview: safePath(files.preview) ? files.preview : undefined },
    pageOffsets,
    preview,
  };
}

function checkDate(raw: unknown): ImportantDate | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.docId) || !isISO(raw.date) || !DATE_KINDS.includes(raw.kind as DateKind)) return null;
  const now = Date.now();
  return {
    id: raw.id,
    docId: raw.docId,
    kind: raw.kind as DateKind,
    date: raw.date,
    note: isStr(raw.note) ? raw.note : "",
    remindDays: isNum(raw.remindDays) ? raw.remindDays : null,
    status: raw.status === "done" || raw.status === "dismissed" ? raw.status : "active",
    createdAt: isNum(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : now,
    notifiedKey: null,
  };
}

/** Structural validation of manifest.json. Throws BackupError when the archive can't be restored at all. */
export function parseManifest(json: unknown): { manifest: Manifest; documents: Array<ManifestDocument | { invalid: string; title: string }> } {
  if (!isObj(json) || json.format !== BACKUP_FORMAT) throw new BackupError("This ZIP file isn't a PAPERTRAIL backup.");
  if (!isNum(json.version) || json.version < 1) throw new BackupError("This backup's manifest is damaged (no version).");
  if (json.version > BACKUP_VERSION) throw new BackupError("This backup was made by a newer version of PAPERTRAIL. Reload the page to get the latest version, then try again.");
  if (!Array.isArray(json.documents)) throw new BackupError("This backup's manifest is damaged (no document list).");
  const documents = json.documents.map((d) => {
    const r = checkManifestDocument(d);
    return typeof r === "string" ? { invalid: r, title: isObj(d) && isStr(d.title) ? d.title : "Untitled document" } : r;
  });
  const tags = (Array.isArray(json.tags) ? json.tags : []).filter((t): t is Tag => isObj(t) && isStr(t.id) && isStr(t.name) && !!t.name.trim()).map((t) => ({ id: t.id, name: t.name.trim(), createdAt: isNum(t.createdAt) ? t.createdAt : Date.now() }));
  const categories = (Array.isArray(json.categories) ? json.categories : [])
    .filter((c): c is Category => isObj(c) && isStr(c.id) && isStr(c.name) && !!c.name.trim())
    .map((c) => ({ id: c.id, name: c.name.trim(), builtIn: false, createdAt: isNum(c.createdAt) ? c.createdAt : Date.now() }));
  const rules = (Array.isArray(json.rules) ? json.rules : [])
    .filter((r): r is Rule => isObj(r) && isStr(r.id) && isStr(r.contains) && ["filename", "text", "anywhere"].includes(r.field as string))
    .map((r) => ({ id: r.id, field: r.field, contains: r.contains, categoryId: isStr(r.categoryId) ? r.categoryId : null, tagId: isStr(r.tagId) ? r.tagId : null, createdAt: isNum(r.createdAt) ? r.createdAt : Date.now() }));
  const dates = (Array.isArray(json.dates) ? json.dates : []).map(checkDate).filter((d): d is ImportantDate => !!d);
  const valid = documents.filter((d): d is ManifestDocument => !("invalid" in d));
  return {
    manifest: {
      format: BACKUP_FORMAT,
      version: json.version,
      createdAt: isStr(json.createdAt) ? json.createdAt : "",
      app: isStr(json.app) ? json.app : "",
      scope: json.scope === "selection" ? "selection" : "library",
      documents: valid,
      tags,
      categories,
      rules,
      dates,
    },
    documents,
  };
}

export type CheckState = "ok" | "duplicate" | "damaged" | "unsupported";

export interface DocCheck {
  title: string;
  state: CheckState;
  reason?: string;
  doc?: ManifestDocument;
  existingId?: string;
}

export interface Inspection {
  manifest: Manifest;
  checks: DocCheck[];
  counts: Record<CheckState, number>;
  dates: number;
  bytes: number;
}

function zipMessage(e: unknown): string {
  if (e instanceof ZipError) {
    if (e.code === "truncated") return "This backup file is incomplete — it was probably cut off by an interrupted download or copy. Export the backup again.";
    if (e.code === "not-zip") return "This file isn't a PAPERTRAIL backup (it isn't a ZIP archive).";
    return `This backup can't be read: ${e.message}`;
  }
  return "This backup file couldn't be read.";
}

/**
 * Opens a backup and checks every document before anything is written: the archive must be
 * complete, each original must be present, of a supported type and match its SHA-256.
 */
export async function inspectBackup(db: DB, file: Blob, onProgress?: (ratio: number) => void): Promise<{ inspection: Inspection; reader: ZipReader }> {
  let reader: ZipReader;
  try {
    reader = await ZipReader.open(file);
  } catch (e) {
    throw new BackupError(zipMessage(e));
  }
  if (!reader.has("manifest.json")) throw new BackupError("This ZIP file doesn't contain a PAPERTRAIL manifest, so it can't be restored.");
  let json: unknown;
  try {
    json = JSON.parse(await reader.readText("manifest.json"));
  } catch (e) {
    throw new BackupError(e instanceof ZipError ? zipMessage(e) : "This backup's manifest is damaged and can't be read.");
  }
  const { manifest, documents } = parseManifest(json);
  const existing = await listDocuments(db);
  const bySha = new Map(existing.map((d) => [d.sha256, d.id]));
  const checks: DocCheck[] = [];
  const total = manifest.documents.reduce((s, d) => s + d.size, 0) || 1;
  let done = 0;
  const seen = new Set<string>();
  for (const d of documents) {
    if ("invalid" in d) {
      checks.push({ title: d.title, state: "damaged", reason: `It can't be restored because ${d.invalid}.` });
      continue;
    }
    const base = { title: d.title, doc: d };
    const dup = bySha.get(d.sha256);
    if (dup || seen.has(d.sha256)) {
      checks.push({ ...base, state: "duplicate", existingId: dup, reason: "Already in your library." });
      done += d.size;
      continue;
    }
    try {
      const bytes = await reader.read(d.files.original);
      done += d.size;
      onProgress?.(done / total);
      if (bytes.length !== d.size) throw new BackupError("its file has the wrong size");
      if ((await sha256Hex(bytes)) !== d.sha256) throw new BackupError("its file doesn't match the recorded checksum");
      const s = sniff(bytes.subarray(0, SNIFF_BYTES), d.fileName, bytes.length);
      if (!s.ok) {
        checks.push({ ...base, state: "unsupported", reason: s.reason });
        continue;
      }
      seen.add(d.sha256);
      checks.push({ ...base, state: "ok" });
    } catch (e) {
      const why = e instanceof BackupError ? e.message : e instanceof ZipError && e.code === "corrupt" && !reader.has(d.files.original) ? "its file is missing from the archive" : e instanceof ZipError ? e.message.replace(/\.$/, "") : "its file couldn't be read";
      checks.push({ ...base, state: "damaged", reason: `It can't be restored because ${why.charAt(0).toLowerCase()}${why.slice(1)}.` });
    }
  }
  const counts: Record<CheckState, number> = { ok: 0, duplicate: 0, damaged: 0, unsupported: 0 };
  checks.forEach((c) => counts[c.state]++);
  const okIds = new Set(checks.filter((c) => c.state === "ok").map((c) => c.doc!.id));
  return {
    inspection: { manifest, checks, counts, dates: manifest.dates.filter((x) => okIds.has(x.docId)).length, bytes: file.size },
    reader,
  };
}

// ── Restore ────────────────────────────────────────────────────────────────

export interface RestoreResult {
  restoredIds: string[];
  failed: Array<{ title: string; reason: string }>;
  /** Restoring stopped early because the browser ran out of storage. */
  stoppedForQuota: boolean;
  dates: number;
}

export async function restoreBackup(db: DB, reader: ZipReader, inspection: Inspection, opts: { onProgress?: (ratio: number) => void } = {}): Promise<RestoreResult> {
  const { manifest } = inspection;
  const result: RestoreResult = { restoredIds: [], failed: [], stoppedForQuota: false, dates: 0 };
  const okDocs = inspection.checks.filter((c) => c.state === "ok").map((c) => c.doc!);
  if (!okDocs.length) return result;

  // Merge tags and categories by name so restoring into a non-empty library doesn't duplicate them.
  const [tags, categories, rules, existingDates] = await Promise.all([listTags(db), listCategories(db), listRules(db), listDates(db)]);
  const tagMap = new Map<string, string>();
  const catMap = new Map<string, string>();
  const newTags: Tag[] = [];
  const newCats: Category[] = [];
  for (const t of manifest.tags) {
    const match = tags.find((x) => fold(x.name) === fold(t.name)) ?? newTags.find((x) => fold(x.name) === fold(t.name));
    if (match) tagMap.set(t.id, match.id);
    else {
      const id = tags.some((x) => x.id === t.id) ? newId() : t.id;
      newTags.push({ ...t, id });
      tagMap.set(t.id, id);
    }
  }
  for (const c of manifest.categories) {
    if (BUILT_IN_IDS.has(c.id)) continue;
    const match = categories.find((x) => fold(x.name) === fold(c.name)) ?? newCats.find((x) => fold(x.name) === fold(c.name));
    if (match) catMap.set(c.id, match.id);
    else {
      const id = categories.some((x) => x.id === c.id) ? newId() : c.id;
      newCats.push({ ...c, id, builtIn: false });
      catMap.set(c.id, id);
    }
  }
  const mapCat = (id: string | null) => (id === null ? null : BUILT_IN_IDS.has(id) ? id : (catMap.get(id) ?? null));
  const mapTag = (id: string | null) => (id === null ? null : (tagMap.get(id) ?? null));
  const newRules = manifest.rules
    .map((r) => ({ ...r, categoryId: mapCat(r.categoryId), tagId: mapTag(r.tagId) }))
    .filter((r) => (r.categoryId || r.tagId) && !rules.some((x) => x.field === r.field && fold(x.contains) === fold(r.contains) && x.categoryId === r.categoryId && x.tagId === r.tagId))
    .map((r) => (rules.some((x) => x.id === r.id) ? { ...r, id: newId() } : r));

  try {
    const tx = db.transaction(["tags", "categories", "rules"], "readwrite");
    await Promise.all([...newTags.map((t) => tx.objectStore("tags").put(t)), ...newCats.map((c) => tx.objectStore("categories").put(c)), ...newRules.map((r) => tx.objectStore("rules").put(r)), tx.done]);
  } catch (e) {
    if (isQuotaError(e)) return { ...result, stoppedForQuota: true };
    throw toStorageError(e);
  }

  const existingIds = new Set((await listDocuments(db)).map((d) => d.id));
  const existingDateIds = new Set(existingDates.map((d) => d.id));
  const total = okDocs.reduce((s, d) => s + d.size, 0) || 1;
  let done = 0;
  for (const m of okDocs) {
    try {
      const id = existingIds.has(m.id) ? newId() : m.id;
      const blob = await reader.readBlob(m.files.original, m.mimeType);
      let text: string | null = null;
      if (m.files.text && reader.has(m.files.text)) text = await reader.readText(m.files.text).catch(() => null);
      let preview: Blob | null = null;
      if (m.files.preview && m.preview && reader.has(m.files.preview)) preview = await reader.readBlob(m.files.preview, "image/jpeg").catch(() => null);
      const { files: _f, pageOffsets, preview: previewSize, ...meta } = m;
      void _f;
      const interrupted = meta.extraction.status === "queued" || meta.extraction.status === "processing";
      const doc: DocumentRecord = {
        ...meta,
        id,
        categoryId: mapCat(meta.categoryId),
        categorySource: mapCat(meta.categoryId) ? meta.categorySource : null,
        tagIds: meta.tagIds.map((t) => tagMap.get(t)).filter((t): t is string => !!t),
        textLength: text?.length ?? 0,
        hasPreview: !!preview,
        extraction: interrupted ? { ...meta.extraction, status: "queued", attempts: 0 } : meta.extraction,
      };
      const dates = manifest.dates
        .filter((d) => d.docId === m.id)
        .map((d) => ({ ...d, docId: id, id: existingDateIds.has(d.id) ? newId() : d.id, notifiedKey: null }));
      await withBlobFallback(async () => {
        const file = await packBlob(blob);
        const thumb = preview && previewSize ? { id, ...previewSize, ...(await packBlob(preview)) } : null;
        const tx = db.transaction(["documents", "files", "texts", "previews", "dates"], "readwrite");
        const ops: Promise<unknown>[] = [];
        try {
          ops.push(tx.objectStore("documents").add(doc));
          ops.push(tx.objectStore("files").put({ id, ...file }));
          if (text) ops.push(tx.objectStore("texts").put({ id, text, pageOffsets }));
          if (thumb) ops.push(tx.objectStore("previews").put(thumb));
          dates.forEach((d) => ops.push(tx.objectStore("dates").put(d)));
        } catch (e) {
          ops.push(Promise.reject(e));
        }
        await settle(tx, ops);
      });
      dates.forEach((d) => existingDateIds.add(d.id));
      existingIds.add(id);
      result.restoredIds.push(id);
      result.dates += dates.length;
    } catch (e) {
      if (isQuotaError(e)) {
        result.stoppedForQuota = true;
        break;
      }
      result.failed.push({ title: m.title, reason: e instanceof ZipError ? e.message : "It couldn't be saved." });
    }
    done += m.size;
    opts.onProgress?.(done / total);
  }
  return result;
}
