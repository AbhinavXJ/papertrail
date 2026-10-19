import type { DB } from "./schema";
import { ALL_STORES } from "./schema";
import {
  DEFAULT_SETTINGS,
  type Category,
  type DocumentRecord,
  type ImportantDate,
  type PreviewRecord,
  type Rule,
  type Settings,
  type StoredBinary,
  type Tag,
  type TextRecord,
} from "@/lib/types";

/** Errors from the storage layer, translated into something a person can act on. */
export class StorageError extends Error {
  constructor(
    public readonly code: "quota" | "not-found" | "unavailable" | "unknown",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}

export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  if (e instanceof StorageError) return e.code === "quota";
  const err = e as { name?: string; code?: unknown; inner?: unknown; cause?: unknown };
  if (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22) return true;
  return isQuotaError(err.inner) || isQuotaError(err.cause);
}

export function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  if (isQuotaError(e))
    return new StorageError(
      "quota",
      "Your browser has run out of storage space for PAPERTRAIL. Free up disk space, or export a backup and remove large documents, then try again.",
      { cause: e },
    );
  const name = (e as { name?: string } | null)?.name;
  if (name === "InvalidStateError" || name === "UnknownError")
    return new StorageError("unavailable", "The browser's local storage isn't available right now. Reload the page and try again.", { cause: e });
  return new StorageError("unknown", "Something went wrong while saving to local storage.", { cause: e });
}

// ── Binary storage (Blob, or ArrayBuffer where Blobs can't be stored) ─────

let blobsUnsupported = false;

/** WebKit in ephemeral sessions rejects Blobs: "Error preparing Blob/File data to be stored in object store". */
function isBlobStoreError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "UnknownError" || name === "DataCloneError" || name === "NotSupportedError";
}

/** Prepares a Blob for storage. Must be awaited *before* opening the transaction. */
export async function packBlob(blob: Blob): Promise<StoredBinary> {
  return blobsUnsupported ? { data: await blob.arrayBuffer(), type: blob.type } : { blob };
}

export function unpackBlob(rec: StoredBinary): Blob {
  return rec.blob ?? new Blob([rec.data ?? new ArrayBuffer(0)], { type: rec.type ?? "" });
}

/** Runs a write; if the browser can't store Blobs, switches to ArrayBuffers and retries once. */
export async function withBlobFallback<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (blobsUnsupported || !isBlobStoreError(e)) throw e;
    blobsUnsupported = true;
    return write();
  }
}

/**
 * Awaits a transaction's requests; on any failure the transaction is explicitly aborted so no
 * partial write survives (some engines fail requests synchronously without aborting).
 */
export async function settle(tx: { abort(): void; done: Promise<void> }, ops: Promise<unknown>[]): Promise<void> {
  try {
    await Promise.all([...ops, tx.done]);
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    await tx.done.catch(() => undefined);
    throw e;
  }
}

/**
 * Checks once, in an isolated transaction, whether this browser can store Blobs in IndexedDB.
 * (WebKit can't in Private Browsing, and doesn't recover cleanly when that failure happens in
 * the middle of a larger transaction, so it must be known before real writes.)
 */
export async function probeBlobSupport(db: DB): Promise<boolean> {
  const probe = (async () => {
    const tx = db.transaction("settings", "readwrite");
    await Promise.all([tx.objectStore("settings").put({ key: "__blobProbe", value: new Blob(["probe"]) }), tx.done]);
    await db.delete("settings", "__blobProbe");
    return true;
  })().catch(() => false);
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 4000));
  const ok = await Promise.race([probe, timeout]);
  blobsUnsupported = !ok;
  return ok;
}

/** Test hook. */
export function resetBlobSupport(unsupported = false): void {
  blobsUnsupported = unsupported;
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toStorageError(e);
  }
}

// ── Documents ──────────────────────────────────────────────────────────────

export const listDocuments = (db: DB) => guard(() => db.getAll("documents"));
export const getDocument = (db: DB, id: string) => guard(() => db.get("documents", id));
export const findBySha256 = (db: DB, sha256: string) => guard(() => db.getAllFromIndex("documents", "sha256", sha256));
export const getFile = (db: DB, id: string) =>
  guard(async () => {
    const rec = await db.get("files", id);
    return rec ? unpackBlob(rec) : null;
  });
export const getText = (db: DB, id: string) => guard(async () => (await db.get("texts", id)) ?? null);
export const getPreview = (db: DB, id: string) =>
  guard(async (): Promise<PreviewRecord | null> => {
    const rec = await db.get("previews", id);
    return rec ? { id: rec.id, blob: unpackBlob(rec), width: rec.width, height: rec.height } : null;
  });

/** Stores the metadata and the original file atomically: either both are saved or neither. */
export function addDocument(db: DB, doc: DocumentRecord, blob: Blob): Promise<void> {
  return guard(() =>
    withBlobFallback(async () => {
      const file = await packBlob(blob);
      const tx = db.transaction(["documents", "files"], "readwrite");
      const ops: Promise<unknown>[] = [];
      try {
        ops.push(tx.objectStore("documents").add(doc));
        ops.push(tx.objectStore("files").put({ id: doc.id, ...file }));
      } catch (e) {
        ops.push(Promise.reject(e));
      }
      await settle(tx, ops);
    }),
  );
}

/**
 * Saves the result of text extraction. `update` receives the document as currently stored (the
 * user may have edited it while it was processed) and returns the record to write — all inside
 * one transaction, so no edit is lost. `text`/`preview`: a record replaces the stored one,
 * `null` deletes it, `undefined` leaves it untouched.
 */
export function saveProcessed(
  db: DB,
  id: string,
  update: (current: DocumentRecord) => DocumentRecord,
  text: TextRecord | null | undefined,
  preview?: PreviewRecord | null,
): Promise<DocumentRecord> {
  return guard(() =>
    withBlobFallback(async () => {
      const packed = preview ? { id: preview.id, width: preview.width, height: preview.height, ...(await packBlob(preview.blob)) } : preview;
      const tx = db.transaction(["documents", "texts", "previews"], "readwrite");
      // Never resurrect a document that was deleted while it was being processed.
      const existing = await tx.objectStore("documents").get(id);
      if (!existing) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new StorageError("not-found", "This document was deleted.");
      }
      const next = { ...update(existing), id };
      const ops: Promise<unknown>[] = [tx.objectStore("documents").put(next)];
      const run = () => {
        if (text) ops.push(tx.objectStore("texts").put(text));
        else if (text === null) ops.push(tx.objectStore("texts").delete(id));
        if (packed) ops.push(tx.objectStore("previews").put(packed));
        else if (packed === null) ops.push(tx.objectStore("previews").delete(id));
      };
      try {
        run();
      } catch (e) {
        ops.push(Promise.reject(e));
      }
      await settle(tx, ops);
      return next;
    }),
  );
}

/** Applies `fn` to each listed document inside one transaction and returns the updated records. */
export function updateDocuments(db: DB, ids: readonly string[], fn: (doc: DocumentRecord) => DocumentRecord, now = Date.now()): Promise<DocumentRecord[]> {
  return guard(async () => {
    const tx = db.transaction("documents", "readwrite");
    const out: DocumentRecord[] = [];
    for (const id of ids) {
      const doc = await tx.store.get(id);
      if (!doc) continue;
      const next = { ...fn(doc), id: doc.id, updatedAt: now };
      await tx.store.put(next);
      out.push(next);
    }
    await tx.done;
    return out;
  });
}

export async function updateDocument(db: DB, id: string, patch: Partial<DocumentRecord>, now = Date.now()): Promise<DocumentRecord> {
  const [doc] = await updateDocuments(db, [id], (d) => ({ ...d, ...patch }), now);
  if (!doc) throw new StorageError("not-found", "This document no longer exists.");
  return doc;
}

/** Removes documents and everything derived from them (file, text, preview, dates). */
export function deleteDocuments(db: DB, ids: readonly string[]): Promise<void> {
  return guard(async () => {
    const tx = db.transaction(["documents", "files", "texts", "previews", "dates"], "readwrite");
    const dateIndex = tx.objectStore("dates").index("docId");
    for (const id of ids) {
      const dateKeys = await dateIndex.getAllKeys(id);
      await Promise.all([
        tx.objectStore("documents").delete(id),
        tx.objectStore("files").delete(id),
        tx.objectStore("texts").delete(id),
        tx.objectStore("previews").delete(id),
        ...dateKeys.map((k) => tx.objectStore("dates").delete(k)),
      ]);
    }
    await tx.done;
  });
}

// ── Tags ───────────────────────────────────────────────────────────────────

export const listTags = (db: DB) => guard(() => db.getAll("tags"));
export const putTag = (db: DB, tag: Tag) => guard(async () => void (await db.put("tags", tag)));

/** Deletes a tag and removes it from every document and rule. Returns ids of affected documents. */
export function deleteTag(db: DB, tagId: string, now = Date.now()): Promise<string[]> {
  return guard(async () => {
    const tx = db.transaction(["tags", "documents", "rules"], "readwrite");
    const affected: string[] = [];
    await tx.objectStore("tags").delete(tagId);
    let cursor = await tx.objectStore("documents").openCursor();
    while (cursor) {
      if (cursor.value.tagIds.includes(tagId)) {
        affected.push(cursor.value.id);
        await cursor.update({ ...cursor.value, tagIds: cursor.value.tagIds.filter((t) => t !== tagId), updatedAt: now });
      }
      cursor = await cursor.continue();
    }
    let rc = await tx.objectStore("rules").openCursor();
    while (rc) {
      if (rc.value.tagId === tagId) {
        if (rc.value.categoryId) await rc.update({ ...rc.value, tagId: null });
        else await rc.delete();
      }
      rc = await rc.continue();
    }
    await tx.done;
    return affected;
  });
}

// ── Categories ─────────────────────────────────────────────────────────────

export const listCategories = (db: DB) => guard(() => db.getAll("categories"));
export const putCategory = (db: DB, c: Category) => guard(async () => void (await db.put("categories", c)));

/** Deletes a custom category; its documents become uncategorized. Returns ids of affected documents. */
export function deleteCategory(db: DB, categoryId: string, now = Date.now()): Promise<string[]> {
  return guard(async () => {
    const tx = db.transaction(["categories", "documents", "rules"], "readwrite");
    const affected: string[] = [];
    await tx.objectStore("categories").delete(categoryId);
    let cursor = await tx.objectStore("documents").openCursor();
    while (cursor) {
      if (cursor.value.categoryId === categoryId) {
        affected.push(cursor.value.id);
        await cursor.update({ ...cursor.value, categoryId: null, categorySource: null, categoryReasons: [], updatedAt: now });
      }
      cursor = await cursor.continue();
    }
    let rc = await tx.objectStore("rules").openCursor();
    while (rc) {
      if (rc.value.categoryId === categoryId) {
        if (rc.value.tagId) await rc.update({ ...rc.value, categoryId: null });
        else await rc.delete();
      }
      rc = await rc.continue();
    }
    await tx.done;
    return affected;
  });
}

// ── Rules ──────────────────────────────────────────────────────────────────

export const listRules = (db: DB) => guard(() => db.getAll("rules"));
export const putRule = (db: DB, r: Rule) => guard(async () => void (await db.put("rules", r)));
export const deleteRule = (db: DB, id: string) => guard(() => db.delete("rules", id));

// ── Important dates ────────────────────────────────────────────────────────

export const listDates = (db: DB) => guard(() => db.getAll("dates"));
export const datesForDocument = (db: DB, docId: string) => guard(() => db.getAllFromIndex("dates", "docId", docId));

export function putDate(db: DB, d: ImportantDate): Promise<void> {
  return guard(async () => {
    const tx = db.transaction(["dates", "documents"], "readwrite");
    const exists = await tx.objectStore("documents").getKey(d.docId);
    if (!exists) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new StorageError("not-found", "The document for this date no longer exists.");
    }
    await Promise.all([tx.objectStore("dates").put(d), tx.done]);
  });
}

export const deleteDate = (db: DB, id: string) => guard(() => db.delete("dates", id));

// ── Settings ───────────────────────────────────────────────────────────────

export function getSettings(db: DB): Promise<Settings> {
  return guard(async () => {
    const rows = await db.getAll("settings");
    const out: Settings = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = r.value;
    return out;
  });
}

export function putSetting<K extends keyof Settings>(db: DB, key: K, value: Settings[K]): Promise<void> {
  return guard(async () => void (await db.put("settings", { key, value })));
}

// ── Whole database ─────────────────────────────────────────────────────────

export function clearAll(db: DB): Promise<void> {
  return guard(async () => {
    const tx = db.transaction(ALL_STORES, "readwrite");
    await Promise.all([...ALL_STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  });
}

export interface LoadedState {
  documents: DocumentRecord[];
  tags: Tag[];
  categories: Category[];
  rules: Rule[];
  dates: ImportantDate[];
  settings: Settings;
}

/** Everything the UI keeps in memory. File blobs and extracted text are loaded on demand. */
export async function loadState(db: DB): Promise<LoadedState> {
  const [documents, tags, categories, rules, dates, settings] = await Promise.all([
    listDocuments(db),
    listTags(db),
    listCategories(db),
    listRules(db),
    listDates(db),
    getSettings(db),
  ]);
  return { documents, tags, categories, rules, dates, settings };
}
