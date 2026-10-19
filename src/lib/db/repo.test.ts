import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteDatabase, openDatabase, type DB } from "./schema";
import * as repo from "./repo";
import { makeDoc } from "@/test/fixtures";
import type { ImportantDate } from "@/lib/types";

let db: DB;
let name: string;

beforeEach(async () => {
  name = `test-${Math.random().toString(36).slice(2)}`;
  db = await openDatabase(name);
});
afterEach(async () => {
  db.close();
  await deleteDatabase(name);
});

const blob = (s: string) => new Blob([s], { type: "application/pdf" });

function date(docId: string, over: Partial<ImportantDate> = {}): ImportantDate {
  return { id: `date-${Math.random()}`, docId, kind: "warranty", date: "2027-01-01", note: "", remindDays: 30, status: "active", createdAt: 1, updatedAt: 1, notifiedKey: null, ...over };
}

describe("documents", () => {
  it("persists a document and its file atomically and reads them back after reopening", async () => {
    const doc = makeDoc({ title: "Lease" });
    await repo.addDocument(db, doc, blob("%PDF-1.4 hello"));
    db.close();
    db = await openDatabase(name);
    expect(await repo.getDocument(db, doc.id)).toEqual(doc);
    expect(await (await repo.getFile(db, doc.id))!.text()).toBe("%PDF-1.4 hello");
    expect((await repo.loadState(db)).documents).toHaveLength(1);
  });

  it("rejects a second document with the same id without writing its file", async () => {
    const doc = makeDoc();
    await repo.addDocument(db, doc, blob("one"));
    await expect(repo.addDocument(db, { ...doc, title: "dup" }, blob("two"))).rejects.toBeInstanceOf(repo.StorageError);
    expect(await (await repo.getFile(db, doc.id))!.text()).toBe("one");
  });

  it("finds duplicates by content hash", async () => {
    const a = makeDoc({ sha256: "a".repeat(64) });
    await repo.addDocument(db, a, blob("x"));
    expect((await repo.findBySha256(db, "a".repeat(64))).map((d) => d.id)).toEqual([a.id]);
    expect(await repo.findBySha256(db, "b".repeat(64))).toEqual([]);
  });

  it("updates metadata and bumps updatedAt", async () => {
    const doc = makeDoc();
    await repo.addDocument(db, doc, blob("x"));
    const next = await repo.updateDocument(db, doc.id, { title: "Renamed", tagIds: ["t1"], notes: "n" }, doc.updatedAt + 5);
    expect(next).toMatchObject({ title: "Renamed", tagIds: ["t1"], notes: "n", updatedAt: doc.updatedAt + 5 });
    expect((await repo.getDocument(db, doc.id))!.title).toBe("Renamed");
    await expect(repo.updateDocument(db, "missing", { title: "x" })).rejects.toMatchObject({ code: "not-found" });
  });

  it("saveProcessed writes text and preview, and refuses to resurrect a deleted document", async () => {
    const doc = makeDoc();
    await repo.addDocument(db, doc, blob("x"));
    const done = (d: typeof doc) => ({ ...d, textLength: 5, hasPreview: true });
    await repo.saveProcessed(db, doc.id, done, { id: doc.id, text: "hello" }, { id: doc.id, blob: new Blob(["jpg"]), width: 10, height: 10 });
    expect((await repo.getText(db, doc.id))!.text).toBe("hello");
    expect(await repo.getPreview(db, doc.id)).not.toBeNull();
    await repo.saveProcessed(db, doc.id, (d) => ({ ...d, textLength: 0 }), null);
    expect(await repo.getText(db, doc.id)).toBeNull();
    expect(await repo.getPreview(db, doc.id)).not.toBeNull();

    await repo.deleteDocuments(db, [doc.id]);
    await expect(repo.saveProcessed(db, doc.id, done, { id: doc.id, text: "late" })).rejects.toMatchObject({ code: "not-found" });
    expect(await repo.getDocument(db, doc.id)).toBeUndefined();
    expect(await repo.getText(db, doc.id)).toBeNull();
  });

  it("saveProcessed keeps edits the user made while the document was processing", async () => {
    const doc = makeDoc({ title: "scan" });
    await repo.addDocument(db, doc, blob("x"));
    await repo.updateDocument(db, doc.id, { title: "Lease", tagIds: ["home"] });
    const saved = await repo.saveProcessed(db, doc.id, (cur) => ({ ...cur, textLength: 3, extraction: { ...cur.extraction, status: "completed" } }), { id: doc.id, text: "abc" });
    expect(saved).toMatchObject({ title: "Lease", tagIds: ["home"], textLength: 3 });
    expect(await repo.getDocument(db, doc.id)).toMatchObject({ title: "Lease", tagIds: ["home"] });
  });

  it("deleting removes the file, text, preview and important dates", async () => {
    const a = makeDoc();
    const b = makeDoc();
    await repo.addDocument(db, a, blob("a"));
    await repo.addDocument(db, b, blob("b"));
    await repo.saveProcessed(db, a.id, () => a, { id: a.id, text: "alpha" }, { id: a.id, blob: new Blob(["p"]), width: 1, height: 1 });
    await repo.putDate(db, date(a.id));
    await repo.putDate(db, date(b.id));
    await repo.deleteDocuments(db, [a.id]);
    expect(await repo.getDocument(db, a.id)).toBeUndefined();
    expect(await repo.getFile(db, a.id)).toBeNull();
    expect(await repo.getText(db, a.id)).toBeNull();
    expect(await repo.getPreview(db, a.id)).toBeNull();
    expect((await repo.listDates(db)).map((d) => d.docId)).toEqual([b.id]);
    expect(await repo.getDocument(db, b.id)).toBeDefined();
  });
});

describe("tags, categories and rules", () => {
  it("deleting a tag removes it from documents and rules", async () => {
    const doc = makeDoc({ tagIds: ["t1", "t2"] });
    await repo.addDocument(db, doc, blob("x"));
    await repo.putTag(db, { id: "t1", name: "home", createdAt: 1 });
    await repo.putRule(db, { id: "r1", field: "anywhere", contains: "rent", categoryId: null, tagId: "t1", createdAt: 1 });
    await repo.putRule(db, { id: "r2", field: "anywhere", contains: "lease", categoryId: "property", tagId: "t1", createdAt: 1 });
    expect(await repo.deleteTag(db, "t1")).toEqual([doc.id]);
    expect((await repo.getDocument(db, doc.id))!.tagIds).toEqual(["t2"]);
    expect(await repo.listTags(db)).toEqual([]);
    const rules = await repo.listRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: "r2", tagId: null });
  });

  it("deleting a category uncategorizes its documents", async () => {
    const doc = makeDoc({ categoryId: "c1", categorySource: "user" });
    await repo.addDocument(db, doc, blob("x"));
    await repo.putCategory(db, { id: "c1", name: "Car", builtIn: false, createdAt: 1 });
    expect(await repo.deleteCategory(db, "c1")).toEqual([doc.id]);
    expect(await repo.getDocument(db, doc.id)).toMatchObject({ categoryId: null, categorySource: null });
  });
});

describe("important dates", () => {
  it("stores dates only for existing documents", async () => {
    const doc = makeDoc();
    await repo.addDocument(db, doc, blob("x"));
    const d = date(doc.id);
    await repo.putDate(db, d);
    await repo.putDate(db, { ...d, status: "done" });
    expect(await repo.datesForDocument(db, doc.id)).toEqual([{ ...d, status: "done" }]);
    await expect(repo.putDate(db, date("ghost"))).rejects.toMatchObject({ code: "not-found" });
    await repo.deleteDate(db, d.id);
    expect(await repo.listDates(db)).toEqual([]);
  });
});

describe("settings and clearing", () => {
  it("merges stored settings over defaults", async () => {
    expect((await repo.getSettings(db)).ocrEnabled).toBe(true);
    await repo.putSetting(db, "ocrEnabled", false);
    await repo.putSetting(db, "lastBackupAt", 123);
    expect(await repo.getSettings(db)).toMatchObject({ ocrEnabled: false, lastBackupAt: 123, view: "list" });
  });

  it("clearAll empties every store", async () => {
    const doc = makeDoc();
    await repo.addDocument(db, doc, blob("x"));
    await repo.putTag(db, { id: "t", name: "t", createdAt: 1 });
    await repo.clearAll(db);
    const s = await repo.loadState(db);
    expect(s.documents).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(await repo.getFile(db, doc.id)).toBeNull();
  });
});

describe("storage failures", () => {
  it("translates quota errors into an actionable StorageError", async () => {
    const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    const fake = {
      transaction() {
        throw quota;
      },
    } as unknown as DB;
    const err = await repo.addDocument(fake, makeDoc(), blob("x")).catch((e) => e);
    expect(err).toBeInstanceOf(repo.StorageError);
    expect(err.code).toBe("quota");
    expect(err.message).toMatch(/run out of storage/);
    expect(repo.isQuotaError({ name: "AbortError", inner: { name: "QuotaExceededError" } })).toBe(true);
    expect(repo.isQuotaError(new Error("other"))).toBe(false);
  });

  it("reports an unavailable database clearly", () => {
    const e = repo.toStorageError(Object.assign(new Error("x"), { name: "InvalidStateError" }));
    expect(e.code).toBe("unavailable");
  });
});

describe("browsers that can't store Blobs in IndexedDB (Safari Private Browsing)", () => {
  it("falls back to ArrayBuffers transparently for files, previews and reads", async () => {
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype;
    const realPut = proto.put;
    proto.put = function (this: unknown, value: unknown, ...rest: unknown[]) {
      if (value && typeof value === "object" && Object.values(value).some((v) => v instanceof Blob))
        throw new DOMException("Error preparing Blob/File data to be stored in object store", "UnknownError");
      return realPut.call(this, value, ...rest);
    };
    repo.resetBlobSupport(false);
    try {
      const doc = makeDoc();
      await repo.addDocument(db, doc, new Blob(["%PDF-1.4 hi"], { type: "application/pdf" }));
      const file = (await repo.getFile(db, doc.id))!;
      expect(file.type).toBe("application/pdf");
      expect(await file.text()).toBe("%PDF-1.4 hi");
      await repo.saveProcessed(db, doc.id, (d) => ({ ...d, hasPreview: true }), { id: doc.id, text: "hi" }, { id: doc.id, blob: new Blob(["jpg"], { type: "image/jpeg" }), width: 3, height: 4 });
      const prev = (await repo.getPreview(db, doc.id))!;
      expect(prev).toMatchObject({ width: 3, height: 4 });
      expect(await prev.blob.text()).toBe("jpg");
    } finally {
      proto.put = realPut;
      repo.resetBlobSupport(false);
    }
  });
});
