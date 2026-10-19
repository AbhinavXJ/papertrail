import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteDatabase, openDatabase, type DB } from "@/lib/db/schema";
import * as repo from "@/lib/db/repo";
import { sha256Hex } from "@/lib/ingest/sniff";
import { makePdf } from "@/lib/samples/pdf-writer";
import { makeDoc } from "@/test/fixtures";
import { BackupError, buildBackup, inspectBackup, parseManifest, restoreBackup } from "./backup";
import { createZip, crc32, ZipReader } from "./zip";

const dbs: Array<[DB, string]> = [];
async function freshDb(): Promise<DB> {
  const name = `bk-${Math.random().toString(36).slice(2)}`;
  const db = await openDatabase(name);
  dbs.push([db, name]);
  return db;
}
afterEach(async () => {
  for (const [db, name] of dbs.splice(0)) {
    db.close();
    await deleteDatabase(name);
  }
});

async function seed(db: DB) {
  const pdf = makePdf([[{ text: "Home insurance policy HM-2291", y: 700 }]]);
  const doc = makeDoc({ id: "policy", title: "Home insurance", fileName: "policy.pdf", size: pdf.length, sha256: await sha256Hex(pdf), tagIds: ["t-home"], categoryId: "c-car", categorySource: "user", notes: "Renew online", hasPreview: true });
  await repo.putTag(db, { id: "t-home", name: "Home", createdAt: 1 });
  await repo.putCategory(db, { id: "c-car", name: "Car & home", builtIn: false, createdAt: 1 });
  await repo.putRule(db, { id: "r1", field: "anywhere", contains: "policy", categoryId: "c-car", tagId: null, createdAt: 1 });
  await repo.addDocument(db, doc, new Blob([pdf], { type: "application/pdf" }));
  await repo.saveProcessed(db, doc.id, () => doc, { id: doc.id, text: "Home insurance policy HM-2291", pageOffsets: [0] }, { id: doc.id, blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: "image/jpeg" }), width: 4, height: 5 });
  await repo.putDate(db, { id: "date-1", docId: doc.id, kind: "insurance-renewal", date: "2027-03-01", note: "", remindDays: 30, status: "active", createdAt: 1, updatedAt: 1, notifiedKey: null });
  const txt = new TextEncoder().encode("Dishwasher manual. Model DW-500.");
  const note = makeDoc({ id: "manual", title: "Dishwasher manual", fileName: "manual.txt", kind: "text", mimeType: "text/plain", size: txt.length, sha256: await sha256Hex(txt) });
  await repo.addDocument(db, note, new Blob([txt], { type: "text/plain" }));
  return { doc, pdf };
}

describe("zip", () => {
  it("round-trips entries and verifies CRCs", async () => {
    const zip = await createZip([
      { name: "a.txt", data: "hello" },
      { name: "dir/ü.bin", data: new Blob([new Uint8Array([1, 2, 3])]) },
    ]);
    const r = await ZipReader.open(zip);
    expect([...r.entries.keys()]).toEqual(["a.txt", "dir/ü.bin"]);
    expect(await r.readText("a.txt")).toBe("hello");
    expect([...(await r.read("dir/ü.bin"))]).toEqual([1, 2, 3]);
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
  });

  it("produces archives that standard unzip tools accept", async () => {
    const zip = await createZip([{ name: "manifest.json", data: "{}" }, { name: "documents/x/file.pdf", data: new Blob([makePdf([[{ text: "x", y: 700 }]])]) }]);
    const dir = mkdtempSync(join(tmpdir(), "pt-"));
    const path = join(dir, "b.zip");
    writeFileSync(path, new Uint8Array(await zip.arrayBuffer()));
    let out = "";
    try {
      out = execFileSync("unzip", ["-t", path], { encoding: "utf8" });
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return; // unzip not installed
      throw e;
    }
    expect(out).toMatch(/No errors detected/);
  });

  it("detects truncated archives and non-zip files", async () => {
    const zip = await createZip([{ name: "a.txt", data: "x".repeat(1000) }]);
    await expect(ZipReader.open(zip.slice(0, 500))).rejects.toMatchObject({ code: "truncated" });
    await expect(ZipReader.open(new Blob(["not a zip at all, definitely not"]))).rejects.toMatchObject({ code: "not-zip" });
  });
});

describe("backup and restore", () => {
  let source: DB;
  beforeEach(async () => {
    source = await freshDb();
  });

  it("restores documents, files, text, previews, tags, categories, rules and dates into a clean workspace", async () => {
    const { pdf } = await seed(source);
    const { blob, documents } = await buildBackup(source);
    expect(documents).toBe(2);

    const target = await freshDb();
    const { inspection, reader } = await inspectBackup(target, blob);
    expect(inspection.counts).toEqual({ ok: 2, duplicate: 0, damaged: 0, unsupported: 0 });
    expect(inspection.dates).toBe(1);
    const res = await restoreBackup(target, reader, inspection);
    expect(res.restoredIds.sort()).toEqual(["manual", "policy"]);
    expect(res.dates).toBe(1);

    const state = await repo.loadState(target);
    const doc = state.documents.find((d) => d.id === "policy")!;
    expect(doc).toMatchObject({ title: "Home insurance", notes: "Renew online", categoryId: "c-car", tagIds: ["t-home"], hasPreview: true });
    expect(new Uint8Array(await (await repo.getFile(target, "policy"))!.arrayBuffer())).toEqual(pdf);
    expect((await repo.getText(target, "policy"))!).toMatchObject({ text: "Home insurance policy HM-2291", pageOffsets: [0] });
    expect(await repo.getPreview(target, "policy")).toMatchObject({ width: 4, height: 5 });
    expect(state.tags.map((t) => t.name)).toEqual(["Home"]);
    expect(state.categories.map((c) => c.name)).toEqual(["Car & home"]);
    expect(state.rules).toHaveLength(1);
    expect(state.dates[0]).toMatchObject({ docId: "policy", kind: "insurance-renewal", date: "2027-03-01" });
  });

  it("skips duplicates and merges tags by name when restoring into the same library", async () => {
    await seed(source);
    const { blob } = await buildBackup(source);
    const { inspection, reader } = await inspectBackup(source, blob);
    expect(inspection.counts.duplicate).toBe(2);
    const res = await restoreBackup(source, reader, inspection);
    expect(res.restoredIds).toEqual([]);
    expect((await repo.listDocuments(source)).length).toBe(2);
    expect((await repo.listTags(source)).length).toBe(1);
  });

  it("gives a restored document a new id if the id is taken by different content", async () => {
    await seed(source);
    const { blob } = await buildBackup(source, { ids: ["manual"] });
    const target = await freshDb();
    await repo.addDocument(target, makeDoc({ id: "manual", sha256: "f".repeat(64) }), new Blob(["other"]));
    const { inspection, reader } = await inspectBackup(target, blob);
    const res = await restoreBackup(target, reader, inspection);
    expect(res.restoredIds).toHaveLength(1);
    expect(res.restoredIds[0]).not.toBe("manual");
    expect((await repo.listDocuments(target)).length).toBe(2);
  });

  it("leaves out (and reports) a document whose stored file can't be read, instead of failing", async () => {
    await seed(source);
    const realTx = source.transaction.bind(source);
    // Simulate a stored blob the browser can no longer read (e.g. evicted backing file).
    const broken = { size: 10, type: "text/plain", stream: () => new ReadableStream({ pull: (c) => c.error(new DOMException("gone", "NotReadableError")) }) } as unknown as Blob;
    (source as unknown as { get: unknown }).get = async (store: string, key: string) => (store === "files" && key === "manual" ? { id: "manual", blob: broken } : realTx(store as "files").objectStore(store as "files").get(key));
    const { documents, skipped, blob } = await buildBackup(source);
    expect(documents).toBe(1);
    expect(skipped).toEqual(["Dishwasher manual"]);
    const m = JSON.parse(await (await ZipReader.open(blob)).readText("manifest.json"));
    expect(m.documents.map((d: { id: string }) => d.id)).toEqual(["policy"]);
  });

  it("exports a selection with only the tags and dates it uses", async () => {
    await seed(source);
    const { blob } = await buildBackup(source, { ids: ["manual"] });
    const r = await ZipReader.open(blob);
    const m = JSON.parse(await r.readText("manifest.json"));
    expect(m.scope).toBe("selection");
    expect(m.documents.map((d: { id: string }) => d.id)).toEqual(["manual"]);
    expect(m.tags).toEqual([]);
    expect(m.dates).toEqual([]);
  });

  it("rejects archives that aren't PAPERTRAIL backups or are incomplete", async () => {
    await seed(source);
    const target = await freshDb();
    const notOurs = await createZip([{ name: "photo.txt", data: "hi" }]);
    await expect(inspectBackup(target, notOurs)).rejects.toThrow(/doesn't contain a PAPERTRAIL manifest/);
    const { blob } = await buildBackup(source);
    await expect(inspectBackup(target, blob.slice(0, blob.size - 40))).rejects.toThrow(/incomplete/);
    await expect(inspectBackup(target, new Blob(["%PDF-1.4 not a zip.............."]))).rejects.toThrow(/isn't a PAPERTRAIL backup/);
    const badJson = await createZip([{ name: "manifest.json", data: "{ nope" }]);
    await expect(inspectBackup(target, badJson)).rejects.toThrow(/manifest is damaged/);
    const future = await createZip([{ name: "manifest.json", data: JSON.stringify({ format: "papertrail-backup", version: 99, documents: [] }) }]);
    await expect(inspectBackup(target, future)).rejects.toThrow(/newer version/);
  });

  it("marks documents with missing, corrupted or unsupported files and restores the rest", async () => {
    await seed(source);
    const { blob } = await buildBackup(source);
    const r = await ZipReader.open(blob);
    const manifest = JSON.parse(await r.readText("manifest.json"));
    const policy = manifest.documents.find((d: { id: string }) => d.id === "policy");
    const manual = manifest.documents.find((d: { id: string }) => d.id === "manual");
    const entries = [
      { name: "manifest.json", data: JSON.stringify({ ...manifest, documents: [policy, manual, { ...manual, id: "evil", sha256: "e".repeat(64) }, { id: 5 }, { ...manual, id: "exe", fileName: "x.exe", files: { original: "documents/exe/x.exe" }, sha256: await sha256Hex(new TextEncoder().encode("MZ binary")), size: 9 }] }) },
      // policy's original is missing; manual is intact; "evil" points at manual's file with the wrong hash.
      { name: manual.files.original, data: new Blob([await r.read(manual.files.original) as Uint8Array<ArrayBuffer>]) },
      { name: "documents/exe/x.exe", data: "MZ binary" },
    ];
    const tampered = await createZip(entries);
    const target = await freshDb();
    const { inspection, reader } = await inspectBackup(target, tampered);
    const byTitle = Object.fromEntries(inspection.checks.map((c) => [c.doc?.id ?? c.title, c]));
    expect(byTitle.policy.state).toBe("damaged");
    expect(byTitle.policy.reason).toMatch(/missing/);
    expect(byTitle.manual.state).toBe("ok");
    expect(byTitle.evil).toMatchObject({ state: "damaged", reason: expect.stringMatching(/checksum/) }); // manual's bytes, wrong hash
    expect(byTitle["Untitled document"].state).toBe("damaged");
    expect(byTitle.exe.state).toBe("unsupported");
    const res = await restoreBackup(target, reader, inspection);
    expect(res.restoredIds).toEqual(["manual"]);
  });

  it("detects a file whose content doesn't match its checksum", async () => {
    await seed(source);
    const { blob } = await buildBackup(source, { ids: ["manual"] });
    const r = await ZipReader.open(blob);
    const manifest = JSON.parse(await r.readText("manifest.json"));
    const m = manifest.documents[0];
    const tampered = await createZip([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: m.files.original, data: "Dishwasher manual. Model DW-999." },
    ]);
    const { inspection } = await inspectBackup(await freshDb(), tampered);
    expect(inspection.checks[0]).toMatchObject({ state: "damaged", reason: expect.stringMatching(/checksum/) });
  });

  it("stops cleanly and reports when storage runs out during restore", async () => {
    await seed(source);
    const { blob } = await buildBackup(source);
    const target = await freshDb();
    const { inspection, reader } = await inspectBackup(target, blob);
    const realTx = target.transaction.bind(target);
    let fileWrites = 0;
    (target as unknown as { transaction: unknown }).transaction = (...args: Parameters<typeof realTx>) => {
      const stores = ([] as string[]).concat(args[0] as string | string[]);
      if (stores.includes("files") && ++fileWrites > 1) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      return realTx(...args);
    };
    const res = await restoreBackup(target, reader, inspection);
    (target as unknown as { transaction: unknown }).transaction = realTx;
    expect(res.stoppedForQuota).toBe(true);
    expect(res.restoredIds.length).toBe(1);
  });

  it("parseManifest validates structure", () => {
    expect(() => parseManifest(null)).toThrow(BackupError);
    expect(() => parseManifest({ format: "papertrail-backup", version: 1 })).toThrow(/document list/);
    const { documents } = parseManifest({ format: "papertrail-backup", version: 1, documents: [{ id: "x" }] });
    expect("invalid" in documents[0]).toBe(true);
  });
});
