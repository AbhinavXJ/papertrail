import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteDatabase, openDatabase, type DB } from "@/lib/db/schema";
import * as repo from "@/lib/db/repo";
import { makeDoc } from "@/test/fixtures";
import { SearchHost } from "./host";

let db: DB;
let name: string;
let host: SearchHost;

beforeEach(async () => {
  name = `host-${Math.random().toString(36).slice(2)}`;
  db = await openDatabase(name);
  host = new SearchHost(() => openDatabase(name));
});
afterEach(async () => {
  host.close();
  db.close();
  await deleteDatabase(name);
});

describe("SearchHost (index ↔ storage)", () => {
  it("builds from stored text, follows metadata edits and drops deleted documents", async () => {
    const doc = makeDoc({ id: "lease", title: "Scan 0042", fileName: "scan0042.pdf" });
    await repo.addDocument(db, doc, new Blob(["%PDF"]));
    await repo.saveProcessed(db, doc.id, () => doc, { id: doc.id, text: "The security deposit is held by the landlord." });
    await repo.putTag(db, { id: "t", name: "Apartment", createdAt: 1 });
    expect((await host.init(name)).count).toBe(1);
    expect(host.query('"security deposit"', null).hits.map((h) => h.id)).toEqual(["lease"]);
    expect(host.query("apartment", null).hits).toHaveLength(0);

    await repo.updateDocument(db, doc.id, { title: "Lease agreement", tagIds: ["t"] });
    await host.upsert([doc.id]);
    expect(host.query("lease agreement", null).hits.map((h) => h.id)).toEqual(["lease"]);
    expect(host.query("apartment", null).hits.map((h) => h.id)).toEqual(["lease"]);
    expect(host.query("scan", null).hits).toHaveLength(1); // file name is still searchable

    await repo.putDate(db, { id: "d", docId: doc.id, kind: "agreement-end", date: "2027-06-30", note: "", remindDays: 60, status: "active", createdAt: 1, updatedAt: 1, notifiedKey: null });
    await host.upsert([doc.id]);
    expect(host.query("agreement ends", null).hits).toHaveLength(1);

    const snip = host.snippets([doc.id], host.query("landlord", null).spec)[doc.id];
    expect(snip?.segments.some(([t, hit]) => hit && t === "landlord")).toBe(true);

    await repo.deleteDocuments(db, [doc.id]);
    await host.upsert([doc.id]);
    expect(host.size).toBe(0);
    expect(host.query("security", null).hits).toHaveLength(0);
  });
});
