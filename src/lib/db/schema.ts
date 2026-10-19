import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Category, DocumentRecord, ImportantDate, Rule, StoredBinary, Tag, TextRecord } from "@/lib/types";

/**
 * Storage layout (one IndexedDB database per workspace):
 *
 *   documents   metadata only (small; loaded into memory at startup)
 *   files       original file blobs, keyed by document id
 *   texts       extracted text (+ page offsets), keyed by document id
 *   previews    small JPEG thumbnails, keyed by document id
 *   tags        user-created tags
 *   categories  user-created categories (built-ins live in code)
 *   rules       user-defined auto-categorization rules
 *   dates       important dates / reminders, indexed by document
 *   settings    key/value application settings
 *
 * The search index is derived data: it is rebuilt in a worker from `documents` + `texts`
 * when the app starts, so it can never drift out of sync with what is stored.
 */
export const DB_VERSION = 1;
export const USER_DB = "papertrail";
export const SAMPLE_DB = "papertrail-sample";

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface PapertrailSchema extends DBSchema {
  documents: { key: string; value: DocumentRecord; indexes: { sha256: string; importedAt: number } };
  files: { key: string; value: StoredBinary & { id: string } };
  texts: { key: string; value: TextRecord };
  previews: { key: string; value: StoredBinary & { id: string; width: number; height: number } };
  tags: { key: string; value: Tag };
  categories: { key: string; value: Category };
  rules: { key: string; value: Rule };
  dates: { key: string; value: ImportantDate; indexes: { docId: string; date: string } };
  settings: { key: string; value: SettingRow };
}

export type DB = IDBPDatabase<PapertrailSchema>;
export type StoreName = "documents" | "files" | "texts" | "previews" | "tags" | "categories" | "rules" | "dates" | "settings";
export const ALL_STORES: StoreName[] = ["documents", "files", "texts", "previews", "tags", "categories", "rules", "dates", "settings"];

export interface OpenOptions {
  /** Another tab upgraded the schema or deleted the database: this connection was closed. */
  onClosed?: () => void;
}

export async function openDatabase(name: string, opts: OpenOptions = {}): Promise<DB> {
  const db = await openDB<PapertrailSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const docs = db.createObjectStore("documents", { keyPath: "id" });
        docs.createIndex("sha256", "sha256");
        docs.createIndex("importedAt", "importedAt");
        db.createObjectStore("files", { keyPath: "id" });
        db.createObjectStore("texts", { keyPath: "id" });
        db.createObjectStore("previews", { keyPath: "id" });
        db.createObjectStore("tags", { keyPath: "id" });
        db.createObjectStore("categories", { keyPath: "id" });
        db.createObjectStore("rules", { keyPath: "id" });
        const dates = db.createObjectStore("dates", { keyPath: "id" });
        dates.createIndex("docId", "docId");
        dates.createIndex("date", "date");
        db.createObjectStore("settings", { keyPath: "key" });
      }
      // Future versions: add `if (oldVersion < 2) { … }` migrations here; never edit the block above.
    },
    blocking() {
      db.close();
      opts.onClosed?.();
    },
    terminated() {
      opts.onClosed?.();
    },
  });
  return db;
}

export async function deleteDatabase(name: string): Promise<void> {
  await deleteDB(name);
}
